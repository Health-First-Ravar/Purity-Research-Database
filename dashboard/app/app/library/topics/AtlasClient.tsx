'use client';

// Knowledge Atlas — drill-down via side panel, not on-canvas expansion.
// Canvas always shows the same 24 branches + cross-links — never re-renders
// on click, so no jiggle/reset. Clicking a branch:
//   1) smoothly zooms the camera to that branch
//   2) populates the right column with the branch's full paper list (name + DOI)
// Drag any node → position persisted to kb_atlas_layout (editor only).

import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';

type Branch = { id: string; label: string; description: string | null; color: string | null };
type Edge   = { source_node_id: string; target_node_id: string; edge_kind: string; rationale: string | null; weight: number };
type Paper  = { id: string; title: string; branchId: string; kind: string; doi: string | null };
type Stats  = { sourcesTotal: number; papersMapped: number; papersUnmapped: number };

type AtlasData = {
  branches: Branch[];
  papers: Paper[];
  edges: Edge[];
  layout: Record<string, { x: number; y: number; locked: boolean }>;
  stats: Stats;
};

type GNode = {
  id: string;
  kind: 'core' | 'branch';
  label: string;
  desc?: string;
  color?: string;
  x?: number; y?: number;
  fx?: number | null; fy?: number | null;
};

type GLink = {
  source: string | GNode;
  target: string | GNode;
  kind: 'parent' | 'cross';
  strength: number;
  rationale?: string;
};

type PanelState =
  | { kind: 'idle' }
  | { kind: 'branch'; branchId: string }
  | { kind: 'core' }
  | { kind: 'edge'; sourceId: string; targetId: string; rationale: string };

const CORE_ID = 'core:hfc';

// Camera control — exposed so the panel's Reset button can drive it
type CameraAPI = {
  zoomToNode: (id: string) => void;
  resetView: () => void;
};

export function AtlasClient() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<CameraAPI | null>(null);
  const [data, setData] = useState<AtlasData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [panel, setPanel] = useState<PanelState>({ kind: 'idle' });

  useEffect(() => {
    fetch('/api/atlas', { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d: AtlasData) => setData(d))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (!data || !containerRef.current) return;
    const api = renderGraph(containerRef.current, data, {
      onSelectNode: (id) => {
        if (id === CORE_ID) setPanel({ kind: 'core' });
        else setPanel({ kind: 'branch', branchId: id });
      },
      onSelectEdge: (sourceId, targetId, rationale) => {
        setPanel({ kind: 'edge', sourceId, targetId, rationale });
      },
    });
    cameraRef.current = api;
    return api.cleanup;
    // Render once per data load — never on panel changes (avoids the jiggle).
  }, [data]);

  // When the panel switches to a branch, smoothly zoom to it
  useEffect(() => {
    if (!cameraRef.current) return;
    if (panel.kind === 'branch') cameraRef.current.zoomToNode(panel.branchId);
    if (panel.kind === 'core') cameraRef.current.zoomToNode(CORE_ID);
  }, [panel]);

  if (error) {
    return (
      <div className="rounded-lg border border-purity-rust/20 bg-purity-rust/5 p-4 text-sm text-purity-rust">
        Failed to load atlas: {error}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex h-[640px] items-center justify-center rounded-lg border border-purity-bean/10 bg-white text-sm text-purity-muted dark:border-purity-paper/10 dark:bg-purity-shade dark:text-purity-mist">
        Loading atlas…
      </div>
    );
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_360px]">
      <div
        ref={containerRef}
        className="relative h-[720px] overflow-hidden rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade"
      >
        <Toolbar
          onReset={() => { cameraRef.current?.resetView(); setPanel({ kind: 'idle' }); }}
        />
        <Footer
          branches={data.branches.length}
          crossLinks={data.edges.filter((e) => e.edge_kind === 'cross').length}
          unmapped={data.stats.papersUnmapped}
        />
      </div>
      <SidePanel panel={panel} data={data} setPanel={setPanel} />
    </div>
  );
}

function Toolbar({ onReset }: { onReset: () => void }) {
  return (
    <div className="absolute right-3 top-3 z-20 flex items-center gap-2 rounded-md border border-purity-bean/10 bg-white/90 px-2 py-1.5 text-[11px] backdrop-blur dark:border-purity-paper/10 dark:bg-purity-shade/90">
      <button onClick={onReset} className="rounded px-2 py-0.5 text-purity-bean hover:bg-purity-cream dark:text-purity-paper dark:hover:bg-purity-ink/40">
        reset view
      </button>
    </div>
  );
}

function Footer({ branches, crossLinks, unmapped }: { branches: number; crossLinks: number; unmapped: number }) {
  return (
    <div className="absolute bottom-3 right-3 z-10 rounded bg-white/85 px-2.5 py-1 text-[11px] text-purity-muted backdrop-blur dark:bg-purity-shade/85 dark:text-purity-mist">
      {branches} branches · {crossLinks} cross-links{unmapped > 0 ? ` · ${unmapped} unmapped` : ''}
    </div>
  );
}

function SidePanel({ panel, data, setPanel }: { panel: PanelState; data: AtlasData; setPanel: (p: PanelState) => void }) {
  if (panel.kind === 'idle') {
    return (
      <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        <h2 className="mb-2 font-serif text-base">Atlas</h2>
        <p className="text-xs text-purity-muted dark:text-purity-mist">
          Health First Coffee at the core. The 24 branches are stable categories;
          dashed lines between them are curated relationships.
        </p>
        <ul className="mt-3 space-y-1.5 text-[11px] text-purity-muted dark:text-purity-mist">
          <li>· <span className="text-purity-bean dark:text-purity-paper">Click</span> a branch — it zooms in and the papers list opens here</li>
          <li>· <span className="text-purity-bean dark:text-purity-paper">Hover</span> a branch — its cross-links light up in aqua</li>
          <li>· <span className="text-purity-bean dark:text-purity-paper">Hover</span> a cross-link — the rationale appears here</li>
          <li>· <span className="text-purity-bean dark:text-purity-paper">Drag</span> any node — editors save its position</li>
        </ul>
        <div className="mt-4 grid grid-cols-3 gap-1.5 text-[11px]">
          <Stat label="papers" value={data.papers.length} />
          <Stat label="branches" value={data.branches.length} />
          <Stat label="cross-links" value={data.edges.filter((e) => e.edge_kind === 'cross').length} />
        </div>
        {data.stats.papersUnmapped > 0 && (
          <div className="mt-3 rounded border border-purity-gold/30 bg-purity-gold/10 px-2 py-1.5 text-[11px] text-purity-muted dark:text-purity-mist">
            {data.stats.papersUnmapped} sources unmapped — open the triage page to route them.
          </div>
        )}
      </aside>
    );
  }

  if (panel.kind === 'edge') {
    const s = data.branches.find((b) => b.id === panel.sourceId);
    const t = data.branches.find((b) => b.id === panel.targetId);
    return (
      <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        <button onClick={() => setPanel({ kind: 'idle' })} className="mb-2 text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">← back</button>
        <h2 className="font-serif text-base">{s?.label ?? panel.sourceId} <span className="text-purity-muted dark:text-purity-mist">↔</span> {t?.label ?? panel.targetId}</h2>
        <span className="my-2 inline-block rounded-full bg-purity-cream/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
          cross-branch link
        </span>
        <p className="text-sm text-purity-muted dark:text-purity-mist">{panel.rationale}</p>
      </aside>
    );
  }

  if (panel.kind === 'core') {
    return (
      <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        <button onClick={() => setPanel({ kind: 'idle' })} className="mb-2 text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">← back</button>
        <h2 className="font-serif text-base">Health First Coffee</h2>
        <span className="my-2 inline-block rounded-full bg-purity-cream/60 px-2 py-0.5 text-[10px] uppercase tracking-wider text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
          core
        </span>
        <p className="text-sm text-purity-muted dark:text-purity-mist">
          The brand frame. Coffee selected, processed, and delivered for human health —
          bioactives optimized, contaminants minimized, evidence cited. The 24 branches
          radiate from this center; the dashed lines between them are the curated cross-relationships.
        </p>
      </aside>
    );
  }

  // panel.kind === 'branch'
  return <BranchPanel branchId={panel.branchId} data={data} setPanel={setPanel} />;
}

function BranchPanel({ branchId, data, setPanel }: { branchId: string; data: AtlasData; setPanel: (p: PanelState) => void }) {
  const branch = data.branches.find((b) => b.id === branchId);
  const papers = useMemo(() => data.papers.filter((p) => p.branchId === branchId), [data.papers, branchId]);
  const connectedBranches = useMemo(() => {
    const ids = new Set<string>();
    for (const e of data.edges) {
      if (e.edge_kind !== 'cross') continue;
      if (e.source_node_id === branchId) ids.add(e.target_node_id);
      if (e.target_node_id === branchId) ids.add(e.source_node_id);
    }
    return Array.from(ids)
      .map((id) => data.branches.find((b) => b.id === id))
      .filter((b): b is Branch => !!b);
  }, [data.edges, data.branches, branchId]);

  if (!branch) {
    return (
      <aside className="rounded-lg border border-purity-bean/10 bg-white p-4 text-sm dark:border-purity-paper/10 dark:bg-purity-shade">
        Branch not found: {branchId}
      </aside>
    );
  }

  return (
    <aside className="flex max-h-[720px] flex-col rounded-lg border border-purity-bean/10 bg-white dark:border-purity-paper/10 dark:bg-purity-shade">
      <div className="border-b border-purity-bean/10 p-4 dark:border-purity-paper/10">
        <button onClick={() => setPanel({ kind: 'idle' })} className="mb-2 text-xs text-purity-muted hover:text-purity-green dark:text-purity-mist dark:hover:text-purity-aqua">← back</button>
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: branch.color ?? '#6B5A3F' }} />
          <h2 className="font-serif text-base">{branch.label}</h2>
        </div>
        {branch.description && (
          <p className="mt-2 text-xs text-purity-muted dark:text-purity-mist">{branch.description}</p>
        )}
        {connectedBranches.length > 0 && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-purity-muted dark:text-purity-mist">
              Cross-links ({connectedBranches.length})
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {connectedBranches.map((b) => (
                <button
                  key={b.id}
                  onClick={() => setPanel({ kind: 'branch', branchId: b.id })}
                  className="rounded-full border border-purity-bean/15 px-2 py-0.5 text-[11px] text-purity-bean hover:bg-purity-cream dark:border-purity-paper/15 dark:text-purity-paper dark:hover:bg-purity-ink/40"
                  style={{ borderLeftColor: b.color ?? undefined, borderLeftWidth: 3 }}
                >
                  {b.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="border-b border-purity-bean/10 px-4 py-2 text-[10px] uppercase tracking-wider text-purity-muted dark:border-purity-paper/10 dark:text-purity-mist">
        Papers ({papers.length})
      </div>
      <div className="overflow-y-auto">
        {papers.length === 0 && (
          <div className="p-4 text-sm text-purity-muted dark:text-purity-mist">
            No papers routed to this branch yet.
          </div>
        )}
        <ul>
          {papers.map((p) => (
            <li
              key={p.id}
              className="border-b border-purity-bean/5 px-4 py-2.5 text-sm last:border-b-0 dark:border-purity-paper/5"
            >
              <div className="leading-snug">{p.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
                <span className="rounded bg-purity-cream/60 px-1.5 py-0.5 text-[10px] text-purity-muted dark:bg-purity-ink/40 dark:text-purity-mist">
                  {p.kind}
                </span>
                {p.doi ? (
                  <a
                    href={`https://doi.org/${p.doi}`}
                    target="_blank" rel="noreferrer"
                    className="text-purity-green hover:underline dark:text-purity-aqua"
                  >
                    {p.doi} ↗
                  </a>
                ) : (
                  <span className="text-purity-muted dark:text-purity-mist">no DOI</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded bg-purity-cream/60 px-2 py-1.5 dark:bg-purity-ink/40">
      <div className="text-base font-medium text-purity-bean dark:text-purity-paper">{value}</div>
      <div className="text-purity-muted dark:text-purity-mist">{label}</div>
    </div>
  );
}

// ----- D3 rendering ---------------------------------------------------------
// Single SVG. Renders only branches + core. Papers live in the side panel.
// The simulation runs ONCE on data load — never restarted on click — so the
// layout never jiggles or resets when you interact.

function renderGraph(
  container: HTMLElement,
  data: AtlasData,
  hooks: {
    onSelectNode: (id: string) => void;
    onSelectEdge: (sourceId: string, targetId: string, rationale: string) => void;
  },
): CameraAPI & { cleanup: () => void } {
  container.querySelectorAll('svg').forEach((s) => s.remove());

  const W = container.clientWidth;
  const H = container.clientHeight;

  const nodes: GNode[] = [{
    id: CORE_ID, kind: 'core', label: 'Health First Coffee',
    desc: 'The brand frame.',
  }];
  for (const b of data.branches) {
    nodes.push({
      id: b.id, kind: 'branch', label: b.label,
      desc: b.description ?? undefined,
      color: b.color ?? '#6B5A3F',
    });
  }

  const links: GLink[] = [];
  for (const b of data.branches) {
    links.push({ source: CORE_ID, target: b.id, kind: 'parent', strength: 0.7 });
  }
  for (const e of data.edges.filter((x) => x.edge_kind === 'cross')) {
    links.push({
      source: e.source_node_id, target: e.target_node_id,
      kind: 'cross',
      strength: Math.max(0.05, Math.min(0.18, Number(e.weight) * 0.15)),
      rationale: e.rationale ?? undefined,
    });
  }

  // Apply persisted positions
  for (const n of nodes) {
    const saved = data.layout[n.id];
    if (saved) {
      n.x = saved.x; n.y = saved.y;
      if (saved.locked) { n.fx = saved.x; n.fy = saved.y; }
    }
  }

  const svg = d3.select(container).append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${W} ${H}`)
    .attr('preserveAspectRatio', 'xMidYMid meet')
    .style('cursor', 'grab')
    .style('font-family', 'inherit');

  const g = svg.append('g');

  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.4, 3])
    .on('zoom', (e) => g.attr('transform', e.transform.toString()));
  svg.call(zoom);

  const crossG = g.append('g').attr('class', 'cross-layer');
  const parentG = g.append('g').attr('class', 'parent-layer');
  const nodeG = g.append('g').attr('class', 'node-layer');

  const sim = d3.forceSimulation<GNode>(nodes)
    .force('link', d3.forceLink<GNode, GLink>(links).id((d) => d.id)
      .distance((d) => {
        if (d.kind === 'cross') return 320;
        const src = typeof d.source === 'string' ? null : d.source;
        if (src && src.kind === 'core') return 260;
        return 70;
      })
      .strength((d) => d.strength))
    .force('charge', d3.forceManyBody().strength((d) => {
      const n = d as unknown as GNode;
      return n.kind === 'core' ? -2200 : -800;
    }))
    .force('center', d3.forceCenter(W / 2, H / 2))
    .force('collide', d3.forceCollide<GNode>().radius((d) =>
      d.kind === 'core' ? 60 : 80))
    .alphaDecay(0.04);

  function curvePath(d: GLink): string {
    const s = typeof d.source === 'string' ? null : d.source;
    const t = typeof d.target === 'string' ? null : d.target;
    if (!s || !t || s.x == null || t.x == null) return '';
    const dx = (t.x ?? 0) - (s.x ?? 0);
    const dy = (t.y ?? 0) - (s.y ?? 0);
    const dr = Math.sqrt(dx * dx + dy * dy);
    if (dr === 0) return '';
    const mx = ((s.x ?? 0) + (t.x ?? 0)) / 2;
    const my = ((s.y ?? 0) + (t.y ?? 0)) / 2;
    const offset = dr * 0.18;
    const px = mx - dy * offset / dr;
    const py = my + dx * offset / dr;
    return `M${s.x},${s.y} Q${px},${py} ${t.x},${t.y}`;
  }

  const crossLines = crossG.selectAll<SVGPathElement, GLink>('path')
    .data(links.filter((l) => l.kind === 'cross'))
    .join('path')
    .attr('class', 'cross')
    .attr('fill', 'none')
    .attr('stroke', 'rgba(61,41,13,0.20)')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3 4')
    .attr('opacity', 0.65)
    .style('cursor', 'help')
    .on('mouseover', function (_e, d) {
      const s = nodes.find((n) => n.id === (typeof d.source === 'string' ? d.source : d.source.id));
      const t = nodes.find((n) => n.id === (typeof d.target === 'string' ? d.target : d.target.id));
      if (!s || !t) return;
      d3.select(this).attr('stroke', '#009F8D').attr('opacity', 1).attr('stroke-width', 1.6);
      hooks.onSelectEdge(s.id, t.id, d.rationale ?? '');
    })
    .on('mouseout', function () {
      d3.select(this).attr('stroke', 'rgba(61,41,13,0.20)').attr('opacity', 0.65).attr('stroke-width', 1);
    });

  const parentLines = parentG.selectAll<SVGLineElement, GLink>('line')
    .data(links.filter((l) => l.kind === 'parent'))
    .join('line')
    .attr('stroke', 'rgba(61,41,13,0.20)')
    .attr('stroke-width', 1.2);

  const nodeSel = nodeG.selectAll<SVGGElement, GNode>('g.node')
    .data(nodes, (d) => d.id)
    .join('g')
    .attr('class', (d) => `node node-${d.kind}`)
    .style('cursor', 'pointer')
    .on('click', (_e, d) => hooks.onSelectNode(d.id))
    .on('mouseover', (_e, d) => {
      crossLines
        .attr('stroke', (cl) => {
          const s = typeof cl.source === 'string' ? cl.source : cl.source.id;
          const t = typeof cl.target === 'string' ? cl.target : cl.target.id;
          return (s === d.id || t === d.id) ? '#009F8D' : 'rgba(61,41,13,0.10)';
        })
        .attr('opacity', (cl) => {
          const s = typeof cl.source === 'string' ? cl.source : cl.source.id;
          const t = typeof cl.target === 'string' ? cl.target : cl.target.id;
          return (s === d.id || t === d.id) ? 1 : 0.25;
        })
        .attr('stroke-width', (cl) => {
          const s = typeof cl.source === 'string' ? cl.source : cl.source.id;
          const t = typeof cl.target === 'string' ? cl.target : cl.target.id;
          return (s === d.id || t === d.id) ? 1.6 : 1;
        });
    })
    .on('mouseout', () => {
      crossLines
        .attr('stroke', 'rgba(61,41,13,0.20)')
        .attr('opacity', 0.65)
        .attr('stroke-width', 1);
    })
    .call(d3.drag<SVGGElement, GNode>()
      .on('start', (event, d) => { if (!event.active) sim.alphaTarget(0.3).restart(); d.fx = d.x; d.fy = d.y; })
      .on('drag',  (event, d) => { d.fx = event.x; d.fy = event.y; })
      .on('end',   (event, d) => {
        if (!event.active) sim.alphaTarget(0);
        if (d.x != null && d.y != null) {
          fetch('/api/atlas/layout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ node_id: d.id, x: d.x, y: d.y }),
          }).catch(() => { /* non-editors get 403 — fine */ });
        }
        d.fx = null; d.fy = null;
      })
    );

  nodeSel.append('circle')
    .attr('r', (d) => d.kind === 'core' ? 9 : 5)
    .attr('fill', (d) => d.kind === 'core' ? '#3D290D' : d.color ?? '#6B5A3F')
    .attr('stroke', 'white')
    .attr('stroke-width', (d) => d.kind === 'core' ? 2 : 1);

  nodeSel.append('text')
    .attr('text-anchor', 'middle')
    .attr('y', (d) => d.kind === 'core' ? 24 : 18)
    .attr('font-size', (d) => d.kind === 'core' ? 14 : 12)
    .attr('font-weight', 500)
    .attr('fill', '#3D290D')
    .style('font-family', (d) => d.kind === 'core' ? "'New York', 'Times New Roman', serif" : 'inherit')
    .style('paint-order', 'stroke')
    .style('stroke', 'white')
    .style('stroke-width', '3px')
    .style('stroke-linejoin', 'round')
    .text((d) => d.label);

  // Branch underline accent
  nodeSel.filter((d) => d.kind === 'branch')
    .append('line')
    .attr('x1', -22).attr('x2', 22)
    .attr('y1', 24).attr('y2', 24)
    .attr('stroke', (d) => d.color ?? '#6B5A3F')
    .attr('stroke-width', 1.5);

  sim.on('tick', () => {
    parentLines
      .attr('x1', (d) => (typeof d.source === 'string' ? 0 : d.source.x ?? 0))
      .attr('y1', (d) => (typeof d.source === 'string' ? 0 : d.source.y ?? 0))
      .attr('x2', (d) => (typeof d.target === 'string' ? 0 : d.target.x ?? 0))
      .attr('y2', (d) => (typeof d.target === 'string' ? 0 : d.target.y ?? 0));
    crossLines.attr('d', curvePath);
    nodeSel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
  });

  // Camera control — smooth zoom on click
  function zoomToNode(id: string) {
    const n = nodes.find((nn) => nn.id === id);
    if (!n || n.x == null || n.y == null) return;
    const targetScale = id === CORE_ID ? 1 : 1.6;
    const tx = W / 2 - n.x * targetScale;
    const ty = H / 2 - n.y * targetScale;
    const transform = d3.zoomIdentity.translate(tx, ty).scale(targetScale);
    svg.transition().duration(650).ease(d3.easeCubicInOut).call(zoom.transform, transform);
  }

  function resetView() {
    svg.transition().duration(650).ease(d3.easeCubicInOut).call(zoom.transform, d3.zoomIdentity);
  }

  return {
    zoomToNode,
    resetView,
    cleanup: () => {
      sim.stop();
      container.querySelectorAll('svg').forEach((s) => s.remove());
    },
  };
}
