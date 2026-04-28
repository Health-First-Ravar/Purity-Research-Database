-- Atlas, round 2: balance the clusters.
-- Adds two new branches that pull a real subset of papers out of the
-- "Health outcomes" megacluster and into more meaningful homes:
--   b:performance — athletic / exercise / ergogenic aid (FLOW's scientific home)
--   b:mechanism   — pharmacokinetics, receptor biology, CYP, gene expression
--                   (how coffee actually works in the body, distinct from
--                    clinical outcome studies)
-- Plus: cross-links connecting them to bioactives + health.

insert into public.kb_atlas_branches (id, label, description, color, display_order) values
  ('b:performance', 'Performance & ergogenics',
   'Athletic performance, endurance, ergogenic aids, exercise outcomes. The why-coffee-helps-you-train branch.',
   '#D97706', 13),
  ('b:mechanism',   'Mechanism & pharmacology',
   'Adenosine receptors, CYP1A2 / CYP3A4, pharmacokinetics, drug interactions, gene expression, epigenetics, circadian rhythm. How coffee acts at the molecular level.',
   '#6D28D9', 14)
on conflict (id) do nothing;

-- Cross-links for the two new branches.
insert into public.kb_atlas_edges (source_node_id, target_node_id, edge_kind, rationale, weight) values
  ('b:performance', 'b:bioactives', 'cross',
    'Caffeine and CGAs are the molecular mechanism behind ergogenic effects.',                                  0.9),
  ('b:performance', 'b:health',     'cross',
    'Performance gains are themselves health outcomes — exercise capacity is a hard endpoint.',                 0.7),
  ('b:performance', 'b:mechanism',  'cross',
    'Adenosine antagonism + catecholamine release explains caffeine''s acute performance window.',              0.9),
  ('b:mechanism',   'b:bioactives', 'cross',
    'Pharmacokinetics describes how bioactives reach their targets in the body.',                               0.9),
  ('b:mechanism',   'b:health',     'cross',
    'Mechanism studies are the bridge from bioactive to clinical outcome.',                                     1.0),
  ('b:mechanism',   'b:contaminant','cross',
    'Acrylamide toxicology operates at the same molecular layer (DNA adducts, CYP metabolism).',                0.6)
on conflict (source_node_id, target_node_id, edge_kind) do nothing;
