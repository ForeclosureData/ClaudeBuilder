import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";

const PROTECTED_PREFIXES = ["/properties", "/watchlist", "/settings", "/admin", "/alerts"];
const ADMIN_PREFIXES = ["/admin"];

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const isProtected = PROTECTED_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));
  const isAdminRoute = ADMIN_PREFIXES.some((p) => request.nextUrl.pathname.startsWith(p));

  if (!supabaseUrl || !supabaseAnonKey) {
    // Supabase not configured (e.g. local demo without a project). Do not
    // block navigation — pages themselves render a "not configured" state.
    return response;
  }

  const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
    cookies: {
      get: (name: string) => request.cookies.get(name)?.value,
      set: (name: string, value: string, options: CookieOptions) => {
        response.cookies.set(name, value, options);
      },
      remove: (name: string, options: CookieOptions) => {
        response.cookies.set(name, "", { ...options, maxAge: 0 });
      },
    },
  });

  const { data } = await supabase.auth.getUser();

  if (isProtected && !data.user) {
    const redirectUrl = new URL("/sign-in", request.url);
    redirectUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (isAdminRoute && data.user) {
    // Cheap edge check only — the admin layout re-verifies the role
    // server-side against Postgres before rendering anything sensitive.
    const role = data.user.app_metadata?.role ?? data.user.user_metadata?.role;
    if (role && role !== "ADMIN") {
      return NextResponse.redirect(new URL("/properties", request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icons|manifest.webmanifest|sw.js|offline.html).*)"],
};
