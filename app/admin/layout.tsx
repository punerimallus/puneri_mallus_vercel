import React from "react";
import { redirect } from 'next/navigation';
import { checkAdminAccess } from '@/lib/admin';
import AdminDock from '@/components/admin/AdminDock';

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // One verified check shared with the API routes: who is logged in, and are they an admin.
  const { isAdmin, user } = await checkAdminAccess();

  if (!user) {
    redirect('/auth/login?next=/admin');
  }

  if (!isAdmin) {
    redirect('/');
  }

  return (
    <section className="admin-wrapper bg-black min-h-screen pb-28">
      {children}
      <AdminDock email={user.email ?? ''} />
    </section>
  );
}