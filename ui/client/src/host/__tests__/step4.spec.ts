import {
  classifyEvidenceFormat,
  collectRequestEvidenceRefs,
  type PlanStep,
  type TreeScopeNode,
} from '../bioharness';
import { layoutPlanGraph } from '../BioHarnessPlanGraph';
import { buildResearchTreeNodes } from '../BioHarnessSidebarSection';

describe('Step 4 scientific views and evidence helpers', () => {
  it('lays out multi-predecessor diamond DAGs with Dagre 2.0.0 without dropping depends_on edges', () => {
    const steps: PlanStep[] = [
      { id: 'S1', kind: 'acquire', objective: 'Collect cohorts' },
      { id: 'S2', kind: 'analyze', objective: 'QC branch A', depends_on: ['S1'] },
      { id: 'S3', kind: 'analyze', objective: 'QC branch B', depends_on: ['S1'] },
      { id: 'S4', kind: 'synthesize', objective: 'Merge A & B', depends_on: ['S2', 'S3'] },
    ];
    const { nodes, edges } = layoutPlanGraph(
      steps,
      [
        { id: 'S1', kind: 'acquire', status: 'DONE', attempts: 1 },
        { id: 'S2', kind: 'analyze', status: 'DONE', attempts: 1 },
        { id: 'S3', kind: 'analyze', status: 'ACTIVE', attempts: 1 },
        { id: 'S4', kind: 'synthesize', status: 'PENDING', attempts: 0 },
      ],
      'S3',
      'S4',
      () => undefined,
    );

    expect(nodes).toHaveLength(4);
    expect(edges.map((e) => e.id).sort()).toEqual(['S1->S2', 'S1->S3', 'S2->S4', 'S3->S4']);

    const byId = new Map(nodes.map((n) => [n.id, n]));
    /* Left-to-right rank monotonicity: S1.x < S2.x/S3.x < S4.x */
    expect(byId.get('S1')!.position.x).toBeLessThan(byId.get('S2')!.position.x);
    expect(byId.get('S1')!.position.x).toBeLessThan(byId.get('S3')!.position.x);
    expect(byId.get('S2')!.position.x).toBeLessThan(byId.get('S4')!.position.x);
    expect(byId.get('S3')!.position.x).toBeLessThan(byId.get('S4')!.position.x);
    /* Non-draggable read-only nodes */
    expect(nodes.every((n) => n.draggable === false)).toBe(true);
    expect(byId.get('S4')!.data.isSelected).toBe(true);
    expect(byId.get('S3')!.data.isCurrent).toBe(true);
  });

  it('builds arbitrary-depth Governance scope/request tree for @rc-component/tree', () => {
    const scopes: TreeScopeNode[] = [
      { scope_id: 'proj-root', parent_scope_id: null, title: 'Genomics Project', request_count: 1 },
      { scope_id: 'sub-rna', parent_scope_id: 'proj-root', title: 'RNA-seq', request_count: 1 },
      {
        scope_id: 'leaf-deg',
        parent_scope_id: 'sub-rna',
        title: 'DEG Analysis',
        request_count: 1,
        requests: [{ request_id: 'req-101', scope_id: 'leaf-deg', request_status: 'OPEN' }],
      },
    ];
    const { nodes, allScopeKeys } = buildResearchTreeNodes(scopes);
    expect(allScopeKeys).toEqual(['scope:proj-root', 'scope:sub-rna', 'scope:leaf-deg']);
    expect(nodes).toHaveLength(1);
    expect(nodes[0].key).toBe('scope:proj-root');
    const level2 = nodes[0].children!.find((c) => c.key === 'scope:sub-rna')!;
    const level3 = level2.children!.find((c) => c.key === 'scope:leaf-deg')!;
    expect(level3.children!.some((c) => c.key === 'req:req-101')).toBe(true);
  });

  it('collects only actual request-scoped EvidenceRefs and deduplicates by exact anchor', () => {
    const shaA = 'a'.repeat(64);
    const shaB = 'b'.repeat(64);
    const refs = collectRequestEvidenceRefs(
      'req-1',
      {
        scope_id: 's1',
        attempts: [
          {
            request_id: 'req-1',
            submission_index: 1,
            step_id: 'S1',
            submission_status: 'ACCEPTED',
            summary: 'ok',
            evidence: [
              { request_id: 'req-1', submission_index: 1, evidence_id: 'ev-1', sha256: shaA, source: '$WORKSPACE/deg.tsv', kind: 'file' },
            ],
          },
          {
            request_id: 'req-OTHER',
            submission_index: 1,
            step_id: 'S1',
            submission_status: 'ACCEPTED',
            summary: 'other',
            evidence: [
              { request_id: 'req-OTHER', submission_index: 1, evidence_id: 'ev-other', sha256: shaB, source: '$WORKSPACE/other.pdf', kind: 'file' },
            ],
          },
        ],
      },
      {
        shared: {
          recent_submissions: [
            {
              request_id: 'req-1',
              submission_index: 1,
              step_id: 'S1',
              submission_status: 'ACCEPTED',
              evidence: [
                { request_id: 'req-1', submission_index: 1, evidence_id: 'ev-1', sha256: shaA, source: '$WORKSPACE/deg.tsv', kind: 'file' },
              ],
            },
          ],
        },
      },
      null,
    );
    expect(refs).toHaveLength(1);
    expect(refs[0].evidence_id).toBe('ev-1');
    expect(refs[0].step_id).toBe('S1');
  });

  it('classifies evidence formats accurately and marks binaries/text-snapshots unsupported', () => {
    expect(classifyEvidenceFormat('paper.pdf', 'file')).toBe('pdf');
    expect(classifyEvidenceFormat('deg.tsv', 'file')).toBe('table');
    expect(classifyEvidenceFormat('counts.csv', 'file')).toBe('table');
    expect(classifyEvidenceFormat('volcano.png', 'file')).toBe('image');
    expect(classifyEvidenceFormat('report.html', 'file')).toBe('html');
    expect(classifyEvidenceFormat('summary.json', 'file')).toBe('code');
    expect(classifyEvidenceFormat('reads.bam', 'file')).toBe('unsupported');
    expect(classifyEvidenceFormat('inline-note', 'text')).toBe('unsupported');
  });
});
