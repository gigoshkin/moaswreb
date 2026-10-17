import { router, usePathname } from "expo-router";
import { Tabs } from "expo-router/js-tabs";
import { View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { scheduleOnRN } from "react-native-worklets";
import { TabBar } from "../../ui/TabBar";
import { haptic } from "../../ui/Tap";
import { color } from "../../ui/theme";

const ORDER = ["/", "/week", "/chat", "/settings"] as const;
/** How far (or how fast) a horizontal swipe has to go to change tab. */
const SWIPE_PT = 60;
const SWIPE_VELOCITY = 600;

export default function TabsLayout() {
  const path = usePathname();
  const index = Math.max(0, ORDER.indexOf(path as (typeof ORDER)[number]));

  const go = (dir: 1 | -1) => {
    const next = ORDER[index + dir];
    if (!next) return;
    haptic("selection");
    router.navigate(next);
  };

  // A mostly horizontal drag: left goes to the next tab, right to the previous one. Vertical scrolling is untouched.
  const swipe = Gesture.Pan()
    .activeOffsetX([-24, 24])
    .failOffsetY([-16, 16])
    .onEnd((e) => {
      const far =
        Math.abs(e.translationX) > SWIPE_PT ||
        Math.abs(e.velocityX) > SWIPE_VELOCITY;
      if (far && Math.abs(e.translationX) > Math.abs(e.translationY))
        scheduleOnRN(go, e.translationX < 0 ? 1 : -1);
    });

  return (
    <GestureDetector gesture={swipe}>
      <View style={{ flex: 1 }}>
        <Tabs
          tabBar={(props) => <TabBar {...props} />}
          screenOptions={{
            headerShown: false,
            animation: "shift",
            sceneStyle: { backgroundColor: color.bg },
          }}
        >
          <Tabs.Screen name="index" />
          <Tabs.Screen name="week" />
          <Tabs.Screen name="chat" />
          <Tabs.Screen name="settings" />
        </Tabs>
      </View>
    </GestureDetector>
  );
}
