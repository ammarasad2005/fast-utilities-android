/**
 * Server-push bootstrap (FCM).
 *
 * The Cloud Function (`fcm-scheduler/`, every 20 min) detects campus dataset
 * changes and fans a data-only ping to the `campus_updates` topic. The native
 * PushMessagingService receives it even from a dead process, repaints widgets
 * and kicks the expedited JS re-sync — which runs the EXISTING tagged-only,
 * merged-summary diff, so notification wording/semantics don't change for
 * users, only their timeliness.
 *
 * This call is the entire JS side: subscribe once per install. The periodic
 * 15-min WorkManager sync stays as the offline/battery fallback.
 */
import { ensurePushSetup } from '../../modules/widget-store/src/WidgetStoreModule';

export function initServerPushSync(): void {
  ensurePushSetup();
}
