import createMiddleware from "next-intl/middleware";
import { type NextRequest, NextResponse } from "next/server";
import { routing } from "@/i18n/routing";
import { updateSession } from "@/lib/supabase/middleware";

const intlMiddleware = createMiddleware(routing);

export async function middleware(request: NextRequest) {
  const { user, supabaseResponse } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  const isProtected =
    /\/(documents|editor)(\/|$)/.test(pathname) ||
    pathname.includes("/api/documents");

  const isLogin = /\/login(\/|$)/.test(pathname);

  if (isProtected && !user && !pathname.startsWith("/api/")) {
    const locale = pathname.split("/")[1] || "ar";
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/login`;
    url.searchParams.set("next", pathname);
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value);
    });
    return redirectResponse;
  }

  if (isLogin && user) {
    const locale = pathname.split("/")[1] || "ar";
    const url = request.nextUrl.clone();
    url.pathname = `/${locale}/documents`;
    const redirectResponse = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((c) => {
      redirectResponse.cookies.set(c.name, c.value);
    });
    return redirectResponse;
  }

  if (pathname.startsWith("/api/")) {
    return supabaseResponse;
  }

  const response = intlMiddleware(request);
  supabaseResponse.cookies.getAll().forEach((c) => {
    response.cookies.set(c.name, c.value);
  });
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
