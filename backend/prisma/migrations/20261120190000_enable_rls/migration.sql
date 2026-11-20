-- Enable Row-Level Security (RLS) on all public tables.
-- Prisma connects as the database owner role (bypassing RLS), while direct
-- Supabase PostgREST access via the public anon key is denied by default.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TokenTransaction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RehearsalSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RehearsalParticipant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GroupClip" ENABLE ROW LEVEL SECURITY;
