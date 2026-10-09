-- PROPOSED, NOT APPLIED. Data fix (no schema change) for the research library.
-- To apply after approval: move this file to migrations/0017_fix_ncsu_proposal_metadata.sql
-- and run `npm run migrate` from dashboard/app. (Files in migrations/proposed/ are
-- not picked up by the runner.)
--
-- sources 3afecc03-50b9-40d9-a795-fcc0ad577c54 is a one-page lab services
-- proposal from NC State, parsed with its contact block (an e-mail address and a
-- phone number) as the title and 2082 as the year. Title and year below are taken
-- from the document's own first lines; it carries no publication year, so the
-- year is cleared rather than guessed. It is already classified
-- source_type = 'marketing', so Ask and the claim checker do not cite it; it
-- stays in the catalog.
--
-- Guarded on the current bad values, so it is a no-op if the row was already fixed.

update public.sources
set title = 'Purity Coffee Proposal: Physicochemical Analyses (Dr. Gabriel Keith Harris, Department of Food, Bioprocessing, and Nutrition Sciences, NC State University)',
    year_published = null
where id = '3afecc03-50b9-40d9-a795-fcc0ad577c54'
  and year_published = 2082
  and title like 'E-mail: gkharris@ncsu.edu%';
