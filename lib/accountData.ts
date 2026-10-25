import AsyncStorage from "@react-native-async-storage/async-storage";
import { resetLocalHistory } from "./history";
import { resetLocalFavorites } from "./favorites";
import { resetLocalCompletion } from "./completion";
import { resetLocalManga } from "./manga/store";
import { resetLocalNotifications } from "./notifications";

// Watch history, favorites, completion, manga and the notification center live
// on the device and are MERGED into the account on sign-in. Sign-out used to
// leave them behind, so the next account on the same phone inherited (and
// re-uploaded) the previous person's 200 episodes. The owner id marks whose
// data is on the device; a different account wipes it before any sync runs.
const OWNER_KEY = "@local_data_owner";
let knownOwner: string | null = null;

export async function wipeAccountLocalData(): Promise<void> {
  await Promise.all([
    resetLocalHistory(),
    resetLocalFavorites(),
    resetLocalCompletion(),
    resetLocalManga(),
    resetLocalNotifications(),
  ].map((p) => p.catch(() => {})));
}

/** Call before exposing a signed-in user to the app. Same account → no-op (an
 *  expired session signing back in keeps its unsynced progress). Legacy devices
 *  with no owner yet adopt the current account. */
export async function claimLocalData(userId: string): Promise<void> {
  if (knownOwner === userId) return;
  const owner = await AsyncStorage.getItem(OWNER_KEY).catch(() => null);
  if (owner && owner !== userId) await wipeAccountLocalData();
  if (owner !== userId) await AsyncStorage.setItem(OWNER_KEY, userId).catch(() => {});
  knownOwner = userId;
}

/** Explicit sign-out: the next person on this phone starts clean. */
export async function releaseLocalData(): Promise<void> {
  await wipeAccountLocalData();
  await AsyncStorage.removeItem(OWNER_KEY).catch(() => {});
  knownOwner = null;
}
