import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface AuthUserPayload {
  id: string;
  email: string;
  name?: string;
  avatarUrl?: string;
}

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  private supabase: SupabaseClient | null = null;

  private getSupabase(): SupabaseClient {
    if (!this.supabase) {
      const url = process.env.SUPABASE_URL?.trim();
      const key = process.env.SUPABASE_ANON_KEY?.trim();
      if (!url || !key) {
        throw new UnauthorizedException('ระบบยืนยันตัวตนยังไม่ได้ตั้งค่า');
      }
      this.supabase = createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    }
    return this.supabase;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{
      headers?: { authorization?: string };
      user?: AuthUserPayload;
    }>();

    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    if (!token) {
      throw new UnauthorizedException('กรุณาเข้าสู่ระบบด้วย Google ก่อนใช้งานฟีเจอร์ AI');
    }

    const { data, error } = await this.getSupabase().auth.getUser(token);
    if (error || !data?.user) {
      throw new UnauthorizedException('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
    }

    const meta = (data.user.user_metadata || {}) as Record<string, unknown>;
    req.user = {
      id: data.user.id,
      email: data.user.email || '',
      name:
        (typeof meta.full_name === 'string' && meta.full_name) ||
        (typeof meta.name === 'string' && meta.name) ||
        undefined,
      avatarUrl:
        (typeof meta.avatar_url === 'string' && meta.avatar_url) ||
        (typeof meta.picture === 'string' && meta.picture) ||
        undefined,
    };

    return true;
  }
}
