import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignInPage() {
  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Sign in</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense>
            <AuthForm mode="sign-in" />
          </Suspense>
          <p className="mt-4 text-center text-sm text-neutral-500">
            <Link href="/reset-password" className="underline">Forgot password?</Link>
          </p>
          <p className="mt-2 text-center text-sm text-neutral-500">
            No account? <Link href="/sign-up" className="underline">Sign up</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
