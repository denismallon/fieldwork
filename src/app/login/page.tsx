"use client";

import { useActionState } from "react";
import { requestMagicLink, type RequestMagicLinkState } from "./actions";

const initialState: RequestMagicLinkState = { submitted: false };

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(requestMagicLink, initialState);

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-semibold text-gray-900">Fieldwork</h1>

        {state.submitted ? (
          <p className="rounded-md border border-gray-200 bg-white p-4 text-center text-sm text-gray-700 shadow-sm">
            If that address is recognised, you will receive an email with a sign-in link shortly.
          </p>
        ) : (
          <form
            action={formAction}
            className="space-y-4 rounded-md border border-gray-200 bg-white p-6 shadow-sm"
          >
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoFocus
                placeholder="you@company.com"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-gray-500 focus:outline-none focus:ring-1 focus:ring-gray-500"
              />
            </div>
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-md bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Sending…" : "Send magic link"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
