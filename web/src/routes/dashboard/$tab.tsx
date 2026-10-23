import { createFileRoute } from '@tanstack/react-router';
import { TabView } from '../../dashboard/TabView';

export const Route = createFileRoute('/dashboard/$tab')({ component: TabView });
