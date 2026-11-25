import { Stack } from "expo-router";
import { C } from "../../lib/theme";
import { GlassScreenLayout } from "../../components/ScreenCanvas";

export default function AuthLayout() {
  return (
    <Stack
      screenLayout={({ children }) => <GlassScreenLayout>{children}</GlassScreenLayout>}
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: C.bg },
        animation: "fade",
      }}
    >
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" />
      <Stack.Screen name="register" />
      <Stack.Screen name="forgot" />
    </Stack>
  );
}
