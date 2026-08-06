import Link from "next/link";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function SignUpPage() {
  return (
    <div className="container-page flex min-h-[70vh] items-center justify-center py-16">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Create your account</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense>
            <AuthForm mode="sign-up" />
          </Suspense>
          <p className="mt-4 text-center text-sm text-neutral-500">
            Already have an account? <Link href="/sign-in" className="underline">Sign in</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
