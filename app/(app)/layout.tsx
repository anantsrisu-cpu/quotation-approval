import { AppProvider } from '@/components/AppProvider';
import { Shell } from '@/components/Shell';

export const dynamic = 'force-dynamic';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}
