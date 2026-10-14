-- The pages of a locked category are readable by editors only (see catalog_locked_categories).
alter policy "docs are readable by anyone with the link" on public.docs
  using (not private.page_locked(path) or (select private.is_editor()));
alter policy "docs are readable by anyone with the link" on public.docs
  rename to "docs are readable by anyone with the link, locked pages by editors";
