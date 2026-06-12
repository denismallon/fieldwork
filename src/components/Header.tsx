import { signOut } from "@/app/(app)/actions";

export default function Header({ email }: { email: string }) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-end gap-4 border-b border-gray-200 bg-white px-6">
      {email && <span className="text-sm text-gray-600">{email}</span>}
      <form action={signOut}>
        <button type="submit" className="text-sm font-medium text-gray-500 hover:text-gray-900">
          Sign out
        </button>
      </form>
    </header>
  );
}
