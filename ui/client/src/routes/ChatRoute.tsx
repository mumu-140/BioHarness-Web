/* BioHarness: changed from LibreChat v0.8.9. Connects `/c/:conversationId?` directly to the
 * BioHarness native vertical slice (workspace/request/conversation/SSE/HITL) inside LibreChat's
 * adopted ChatScreen and MessagesView. */
import BioHarnessChatRoute from '~/host/BioHarnessChatRoute';

export default function ChatRoute() {
  return <BioHarnessChatRoute />;
}
