-- Engine choice per generation.
--
-- A creator can have their likeness trained on more than one engine (Arjun:
-- Tavus 16:9 studio replica AND HeyGen 9:16 social avatar). The listing still
-- points at ONE canonical avatar row, so until now every generation silently
-- used that engine. `requested_engine` records the brand's explicit pick; the
-- worker resolves it to the creator's ready avatar on that engine, and the
-- pick also OVERRIDES demo-safe-mode — choosing a live engine is a deliberate
-- act of spending, whereas the staged demo path never sets it and stays on the
-- free mock engine.
--
-- Guard-rails unchanged: the same consent re-check runs against whichever
-- avatar actually renders, and create_generation()'s six gates run before any
-- engine is consulted at all.
alter table generations add column if not exists requested_engine text
  check (requested_engine in ('tavus', 'heygen', 'did'));
