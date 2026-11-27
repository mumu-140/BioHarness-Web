/* BioHarness: changed from LibreChat v0.8.9. Per roadmap §17.5, reuse the complete GFM, math,
 * KaTeX and code-block renderer while disabling executable Artifacts and MCP-app directives. */
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import supersub from 'remark-supersub';
import type { PluggableList } from 'unified';
import type { ElementType } from 'react';
import type { RehypeModules } from './rehype';
import {
  code,
  a,
  p,
  img,
  table,
  ul,
  ol,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  blockquote,
} from './MarkdownComponents';
import { remarkApproxTilde, remarkSingleDollarMath } from '~/utils';
import { toRehypePlugins } from './rehype';

export const getRemarkPlugins = (latexParsing = true): PluggableList => [
  remarkApproxTilde,
  supersub,
  remarkGfm,
  [remarkMath, { singleDollarTextMath: false }],
  ...(latexParsing ? [remarkSingleDollarMath] : []),
];

export const getRehypePlugins = (modules: RehypeModules | null): PluggableList =>
  toRehypePlugins(modules);

export const getMarkdownComponents = (): { [nodeType: string]: ElementType } => ({
  code,
  a,
  p,
  img,
  table,
  ul,
  ol,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  blockquote,
});
