import React from 'react';
import { render, screen } from '@testing-library/react';
import {
  LiteratureDomainCard,
  ObservedDomainOutputBanner,
  ProteinMethodsDomainCard,
  ScientificReviewCard,
  StatisticsDomainCard,
} from '../BioHarnessDomainRenderers';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { resolvedLanguage: 'zh-Hans', language: 'zh-Hans' },
  }),
}));

describe('R3.4 Professional Scientific Module Domain Renderers', () => {
  it('renders Literature results with coverage disclosure, identifiers, and pagination info', () => {
    render(
      <LiteratureDomainCard
        data={{
          operation: 'search',
          source: 'openalex',
          coverage: 'ranked_subset_not_exhaustive',
          reported_total_results: 42,
          returned_records: 2,
          total_items: 2,
          offset: 0,
          has_more: false,
          items: [
            {
              rank: 1,
              title: 'Plant GRF Transcription Factors',
              authors: ['Kim JH'],
              year: 2024,
              doi: '10.1016/j.molp.2024.01.001',
              identifier: '10.1016/j.molp.2024.01.001',
              identifier_status: 'resolved',
            },
          ],
        }}
      />,
    );
    expect(screen.getByTestId('bh-domain-literature-card')).toHaveTextContent('Plant GRF Transcription Factors');
    expect(screen.getByTestId('bh-lit-coverage-badge')).toHaveTextContent('ranked_subset_not_exhaustive');
  });

  it('renders Statistics records verbatim with numerator/denominator, CI, p-value, FDR, and PASS status', () => {
    render(
      <StatisticsDomainCard
        data={{
          action: 'render',
          status: 'PASS',
          records: [
            {
              metric_id: 'mut_rate',
              unit: 'proportion',
              value: 0.15,
              numerator: 6,
              denominator: 40,
              population: 'cohort=HRpos',
              stratum: 'alteration=ESR1',
              method: 'Exact binomial',
              ci_low: 0.06,
              ci_high: 0.29,
              ci_level: 0.95,
              p_value: 0.004,
              fdr: 0.018,
            },
          ],
          rendered_markdown: 'Rate: P(alteration=ESR1 | cohort=HRpos) = 15.0%(6/40).',
        }}
      />,
    );
    expect(screen.getByTestId('bh-stat-status-badge')).toHaveTextContent('PASS');
    const row = screen.getByTestId('bh-stat-row-mut_rate');
    expect(row).toHaveTextContent('6 / 40');
    expect(row).toHaveTextContent('p=0.004');
    expect(row).toHaveTextContent('FDR=0.018');
    expect(screen.getByTestId('bh-stat-rendered-md')).toHaveTextContent('15.0%(6/40)');
  });

  it('renders non-blocking Scientific Review opinion parsing issue/basis/impact and rework attempts', () => {
    render(
      <ScientificReviewCard
        title="Plan Scientific Review"
        advice={{
          verdict: 'CONCERNS',
          summary: 'Check replicate independence.',
          concerns: [
            'Technical replicates pooled | Basis: design_table.csv | Scientific impact: inflates effective n',
          ],
          suggestions: ['Separate biological and technical replicates'],
        }}
        attempts={2}
        previousAttempt={{ status: 'PARTIAL', summary: 'Initial draft pooled technical replicates' }}
      />,
    );
    expect(screen.getByTestId('bh-review-verdict')).toHaveTextContent('CONCERNS');
    const card = screen.getByTestId('bh-domain-review-card');
    expect(card).toHaveTextContent('Technical replicates pooled');
    expect(card).toHaveTextContent('design_table.csv');
    expect(card).toHaveTextContent('inflates effective n');
    expect(card).toHaveTextContent('Initial draft pooled technical replicates');
  });

  it('renders Protein Methods structure-inventory output and auto-detects inside execution inspector', () => {
    const pmPayload = {
      operation: 'structure-inventory',
      status: 'observed',
      module_version: '0.2.0',
      format: 'pdb',
      protein_residue_count: 1,
      unambiguous_atom_count: 4,
      residues: [{ chain: 'A', residue_name: 'ALA', residue_number: 1, unambiguous_atom_count: 4 }],
    };
    render(<ObservedDomainOutputBanner output={pmPayload} name="protein-methods" />);
    expect(screen.getByTestId('bh-domain-protein-card')).toHaveTextContent('v0.2.0');
    expect(screen.getByTestId('bh-protein-atom-count')).toHaveTextContent('4');
  });
});
