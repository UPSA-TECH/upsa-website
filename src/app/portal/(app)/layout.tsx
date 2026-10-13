import PortalShell from '../_components/PortalShell';
import ChatDock from '../_components/ChatDock';
import { ChatWidgetProvider } from '../_lib/ChatWidgetProvider';

export default function PortalAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <ChatWidgetProvider>
      <PortalShell>{children}</PortalShell>
      <ChatDock />
    </ChatWidgetProvider>
  );
}
