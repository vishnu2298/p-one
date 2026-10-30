import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DefaultTheme, useNavigation, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuth } from './context';
import { Loading, Txt } from './ui';
import { colors, shadow } from './theme';
import { BlurView } from 'expo-blur';
import { LinearGradient } from 'expo-linear-gradient';
import { Logo } from './components/Logo';
import { Login, Register, Welcome } from './screens/Auth';
import { Home } from './screens/Home';
import { Explore, Listings, Search } from './screens/Browse';
import { ItemDetails } from './screens/ItemDetails';
import { SellItem } from './screens/Sell';
import { Chat } from './screens/Chat';
import { Messages } from './screens/Messages';
import { Connect } from './screens/Connect';
import { Profile } from './screens/Profile';
import { UserProfile } from './screens/UserProfile';
import { Favorites, MyListings, Orders } from './screens/Lists';
import { EditProfile, Report, Safety, Settings } from './screens/Account';
import { CompleteProfile, GoogleDevSignIn, PhoneSignIn } from './screens/SignIn';
import { Deals } from './screens/Deals';
import { Invite } from './screens/Invite';
import { Notifications, routeFor } from './screens/Notifications';
import { BrandHub } from './screens/BrandHub';
import { Legal } from './screens/Legal';
import { GroupScreen } from './screens/Groups';
import { listenForNotificationTaps } from './push';
import { AnimatedSplash, Pop, haptic } from './motion';
import * as Linking from 'expo-linking';

const Stack = createNativeStackNavigator();
const navRef = createNavigationContainerRef<any>();
const Tabs = createBottomTabNavigator();

const TAB_ICONS: Record<string, [string, string, string]> = {
  Home: ['home', 'home-outline', 'Home'],
  Explore: ['grid', 'grid-outline', 'Explore'],
  Messages: ['chatbubbles', 'chatbubbles-outline', 'Messages'],
  Profile: ['person', 'person-outline', 'Profile'],
};

function SellPulse() {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
      Animated.timing(v, { toValue: 0, duration: 1400, easing: Easing.inOut(Easing.ease), useNativeDriver: Platform.OS !== 'web' }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ width: 62, height: 62, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View style={{ position: 'absolute', width: 62, height: 62, borderRadius: 31, backgroundColor: colors.primary, opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 0] }), transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 1.55] }) }] }} />
      <LinearGradient colors={[colors.primary, colors.accent]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 62, height: 62, borderRadius: 31, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: 'rgba(255,255,255,0.95)', boxShadow: '0px 10px 24px rgba(79,70,229,0.45)' } as any}>
        <Ionicons name="add" size={38} color="#fff" />
      </LinearGradient>
    </View>
  );
}

function TabBar({ state, navigation }: any) {
  const insets = useSafeAreaInsets();
  const root = useNavigation<any>();
  const [badge, setBadge] = useState(0);
  useEffect(() => {
    let live = true;
    const tick = () => api<{ messages: number; requests: number }>('/unread-count').then((r) => live && setBadge(r.messages + r.requests)).catch(() => {});
    tick(); const t = setInterval(tick, 10000);
    return () => { live = false; clearInterval(t); };
  }, [state.index]);

  const items = [state.routes[0], state.routes[1], { key: 'sell', name: 'Sell' }, state.routes[2], state.routes[3]];
  return (
    <View style={{ paddingHorizontal: 14, paddingBottom: insets.bottom + 8, paddingTop: 22 }}>
    {/* The glass pill is a separate clipped layer so the raised Sell button can rise above it. */}
    <View pointerEvents="none" style={{ position: 'absolute', left: 14, right: 14, top: 22, bottom: insets.bottom + 8, borderRadius: 32, overflow: 'hidden', borderWidth: 1, borderColor: colors.glassBorder, ...shadow }}>
      <BlurView intensity={70} tint="light" experimentalBlurMethod="dimezisBlurView" style={{ flex: 1, backgroundColor: 'rgba(255,255,255,0.55)' }} />
    </View>
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingTop: 8, paddingBottom: 8, alignItems: 'flex-end' }}>
      {items.map((r: any) => {
        if (r.name === 'Sell') {
          return (
            <Pressable key="sell" accessibilityRole="button" accessibilityLabel="Sell an item" onPress={() => { haptic.tap(); root.navigate('SellItem'); }} style={{ flex: 1, alignItems: 'center', marginTop: -26 }}>
              <SellPulse />
              <Txt variant="tiny" bold color={colors.primary}>Sell</Txt>
            </Pressable>
          );
        }
        const focused = state.routes[state.index].name === r.name;
        const [on, off, label] = TAB_ICONS[r.name];
        return (
          <Pressable key={r.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }} onPress={() => { if (!focused) { haptic.tap(); navigation.navigate(r.name); } }} style={{ flex: 1, alignItems: 'center', minHeight: 56, justifyContent: 'center', gap: 2 }}>
            <View>
              <Pop trigger={focused}><Ionicons name={(focused ? on : off) as any} size={27} color={focused ? colors.primary : colors.sub} /></Pop>
              {r.name === 'Messages' && badge ? <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Txt variant="tiny" bold color="#fff" style={{ lineHeight: 16 }}>{badge > 9 ? '9+' : badge}</Txt></View> : null}
            </View>
            <Txt variant="tiny" bold color={focused ? colors.primary : colors.sub}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
    </View>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, animation: 'fade', sceneStyle: { backgroundColor: 'transparent' } }}>
      <Tabs.Screen name="Home" component={Home} />
      <Tabs.Screen name="Explore" component={Explore} />
      <Tabs.Screen name="Messages" component={Messages} />
      <Tabs.Screen name="Profile" component={Profile} />
    </Tabs.Navigator>
  );
}

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: 'transparent', card: 'transparent', primary: colors.primary } };

export function RootNavigator() {
  const { ready, user } = useAuth();
  // connectly://item/123 (from a shared WhatsApp link) opens that item once signed in.
  const pendingItem = useRef<number | null>(null);
  useEffect(() => {
    const take = (url: string | null) => {
      const m = url && /item\/(\d+)/.exec(url);
      if (!m) return;
      pendingItem.current = Number(m[1]);
      if (user && !user.needsProfile && navRef.isReady()) { navRef.navigate('ItemDetails', { id: pendingItem.current }); pendingItem.current = null; }
    };
    void Linking.getInitialURL().then(take);
    const sub = Linking.addEventListener('url', (e) => take(e.url));
    return () => sub.remove();
  }, [user?.id, user?.needsProfile]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (user && !user.needsProfile && pendingItem.current && navRef.isReady()) { navRef.navigate('ItemDetails', { id: pendingItem.current }); pendingItem.current = null; }
  }, [user?.id, user?.needsProfile]);

  // Tapping a push notification opens the right screen (native only; a no-op on web).
  useEffect(() => {
    if (!user || user.needsProfile) return;
    return listenForNotificationTaps((data) => {
      const target = routeFor(data);
      if (target && navRef.isReady()) navRef.navigate(target[0], target[1]);
    });
  }, [user?.id, user?.needsProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) return <AnimatedSplash />;
  return (
    <NavigationContainer theme={theme} ref={navRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right', contentStyle: { backgroundColor: 'transparent' } }}>
        {!user ? (
          <>
            <Stack.Screen name="Welcome" component={Welcome} />
            <Stack.Screen name="PhoneSignIn" component={PhoneSignIn} />
            <Stack.Screen name="GoogleDev" component={GoogleDevSignIn} />
            <Stack.Screen name="Login" component={Login} />
            <Stack.Screen name="Legal" component={Legal} />
            <Stack.Screen name="Register" component={Register} />
          </>
        ) : user.needsProfile ? (
          <Stack.Screen name="CompleteProfile" component={CompleteProfile} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainTabs} />
            <Stack.Screen name="Deals" component={Deals} />
            <Stack.Screen name="Invite" component={Invite} />
            <Stack.Screen name="Notifications" component={Notifications} />
            <Stack.Screen name="BrandHub" component={BrandHub} />
            <Stack.Screen name="Legal" component={Legal} />
            <Stack.Screen name="Group" component={GroupScreen} />
            <Stack.Screen name="Listings" component={Listings} />
            <Stack.Screen name="Search" component={Search} />
            <Stack.Screen name="ItemDetails" component={ItemDetails} />
            <Stack.Screen name="SellItem" component={SellItem} options={{ animation: 'slide_from_bottom' }} />
            <Stack.Screen name="Chat" component={Chat} />
            <Stack.Screen name="Connect" component={Connect} />
            <Stack.Screen name="UserProfile" component={UserProfile} />
            <Stack.Screen name="MyListings" component={MyListings} />
            <Stack.Screen name="Orders" component={Orders} />
            <Stack.Screen name="Favorites" component={Favorites} />
            <Stack.Screen name="EditProfile" component={EditProfile} />
            <Stack.Screen name="Settings" component={Settings} />
            <Stack.Screen name="Safety" component={Safety} />
            <Stack.Screen name="Report" component={Report} options={{ animation: 'slide_from_bottom' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
