-- Locked categories: an editor can lock a category ("Bloquear para Viewer", catalog/tree: categories[].locked = true)
-- while it is being prepared. Its name stays in the menu, but the pages of its subcategories are readable by editors
-- only, so nobody else can load them, not even with a direct link or through the Data API.

-- True when p_path is the page of a subcategory of a locked category. Security definer: it reads the tree without
-- going through the policies of public.docs (which call it).
create or replace function private.page_locked(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_path like 'pages/%' and exists (
    select 1
      from public.docs t
     cross join lateral jsonb_array_elements(case when jsonb_typeof(t.data -> 'categories') = 'array' then t.data -> 'categories' else '[]'::jsonb end) c
     cross join lateral jsonb_array_elements(case when jsonb_typeof(c -> 'subs') = 'array' then c -> 'subs' else '[]'::jsonb end) s
     where t.path = 'catalog/tree'
       and c ->> 'locked' = 'true'
       and 'pages/' || (s ->> 'id') = p_path
  );
$$;
grant execute on function private.page_locked(text) to anon, authenticated;
