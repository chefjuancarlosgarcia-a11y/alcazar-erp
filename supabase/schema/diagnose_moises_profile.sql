select id, email, full_name, username, role, status, area_id, area_name
from public.profiles
where lower(coalesce(full_name, username, email, '')) like '%mois%'
order by full_name;
