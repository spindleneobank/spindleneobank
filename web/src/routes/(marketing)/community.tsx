import { createFileRoute } from '@tanstack/react-router';
import { pageHead } from '../../components/marketing/F0n';
import { CommunityPage } from '../../features/marketing/about/CommunityPage';

export const Route = createFileRoute('/(marketing)/community')({
  head: () =>
    pageHead(
      'Community',
      'Follow Spindle’s compute and payout design. Join the community on Telegram and X.',
      '/community',
    ),
  component: CommunityPage,
});
