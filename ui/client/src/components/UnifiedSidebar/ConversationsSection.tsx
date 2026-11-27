/* BioHarness: changed from LibreChat v0.8.9. Seats BioHarness workspace selector, native runtime
 * conversations and open Core requests directly inside LibreChat's adopted UnifiedSidebar. */
import { memo } from 'react';
import BioHarnessSidebarSection from '~/host/BioHarnessSidebarSection';

const ConversationsSection = memo(() => <BioHarnessSidebarSection />);

ConversationsSection.displayName = 'ConversationsSection';

export default ConversationsSection;
