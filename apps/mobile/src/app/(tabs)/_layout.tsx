import { router, usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { TabBar } from "../../ui/TabBar";
import { haptic } from "../../ui/Tap";
import { color, spring } from "../../ui/theme";

const ORDER = ["/", "/week", "/chat", "/settings"] as const;
/** How far (or how fast) a horizontal swipe has to go to change tab. */
const SWIPE_FRACTION = 0.28;
const SWIPE_VELOCITY = 600;
/** Past the first or last tab the page only follows the finger this much. */
const RUBBER = 0.25;

export default function TabsLayout() {
  const path = usePathname();
  const { width } = useWindowDimensions();
  const index = Math.max(0, ORDER.indexOf(path as (typeof ORDER)[number]));
  /** Horizontal offset of the page, driven by the finger and then by the settle animation. */
  const dx = useSharedValue(0);

  const go = (dir: 1 | -1) => {
    const next = ORDER[index + dir];
    if (!next) return;
    haptic("selection");
    router.navigate(next);
  };

  // A mostly horizontal drag: the page follows the finger, left goes to the next tab, right to the previous one.
  // Vertical scrolling is untouched.
  const swipe = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-16, 16])
    .onBegin(() => {
      cancelAnimation(dx);
    })
    .onUpdate((e) => {
      const dir = e.translationX < 0 ? 1 : -1;
      const edge = index + dir < 0 || index + dir >= ORDER.length;
      dx.value = edge ? e.translationX * RUBBER : e.translationX;
    })
    .onEnd((e) => {
      const dir = e.translationX < 0 ? 1 : -1;
      const edge = index + dir < 0 || index + dir >= ORDER.length;
      const far =
        Math.abs(e.translationX) > width * SWIPE_FRACTION ||
        Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (!far || edge || Math.abs(e.translationX) < Math.abs(e.translationY)) {
        dx.value = withSpring(0, spring.smooth);
        return;
      }
      // Fly the old page off, swap the tab while nothing is visible, then bring the new page in from the far side.
      dx.value = withTiming(
        -dir * width,
        { duration: 140, easing: Easing.out(Easing.quad) },
        (done) => {
          if (!done) return;
          scheduleOnRN(go, dir);
          dx.value = dir * width;
          // The short delay lets the navigation land first, so the old tab never slides back in.
          dx.value = withDelay(60, withTiming(0, { duration: 220, easing: Easing.out(Easing.cubic) }));
        },
      );
    });

  const page = useAnimatedStyle(() => ({ transform: [{ translateX: dx.value }] }));
  // The tab bar stays put: it cancels the page's movement.
  const stay = useAnimatedStyle(() => ({ transform: [{ translateX: -dx.value }] }));

  return (
    <GestureDetector gesture={swipe}>
      <Animated.View style={[{ flex: 1, backgroundColor: color.bg }, page]}>
        <Tabs
          tabBar={(props) => (
            <Animated.View style={stay}>
              <TabBar {...props} />
            </Animated.View>
          )}
          screenOptions={{
            headerShown: false,
            animation: "none",
            sceneStyle: { backgroundColor: color.bg },
          }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="week" />
          <Tabs.Screen name="chat" />
          <Tabs.Screen name="settings" />
        </Tabs>
      </Animated.View>
    </GestureDetector>
  );
}
