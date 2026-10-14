-- Source files: a module can offer its originals for download next to the preview (PDF guides, ZIP packs, EPS and AI
-- vectors). The assets bucket accepts those types too; the size limit (50 MB) and the policies stay as they are.
update storage.buckets
set allowed_mime_types = array[
  'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm',
  'application/pdf', 'application/zip', 'application/postscript', 'application/illustrator'
]
where id = 'assets';
