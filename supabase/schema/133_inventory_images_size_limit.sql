-- Increase inventory product image upload limit to 10 MB.
-- Frontend compresses large camera photos before upload; this raises the storage ceiling.

update storage.buckets
set file_size_limit = 10485760
where id = 'inventory-images';
