import React, { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NavigationContainer, DefaultTheme, useNavigation, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from './api';
import { useAuth } from './context';
import { Loading, Txt } from './ui';
import { colors } from './theme';
import { Logo } from './components/Logo';
import { Login, Onboarding, Register, Welcome } from './screens/Auth';
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
import { listenForNotificationTaps } from './push';

const Stack = createNativeStackNavigator();
const navRef = createNavigationContainerRef<any>();
const Tabs = createBottomTabNavigator();

const TAB_ICONS: Record<string, [string, string, string]> = {
  Home: ['home', 'home-outline', 'Home'],
  Explore: ['grid', 'grid-outline', 'Explore'],
  Messages: ['chatbubbles', 'chatbubbles-outline', 'Messages'],
  Profile: ['person', 'person-outline', 'Profile'],
};

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
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.line, paddingBottom: insets.bottom + 6, paddingTop: 6, alignItems: 'flex-end' }}>
      {items.map((r: any) => {
        if (r.name === 'Sell') {
          return (
            <Pressable key="sell" accessibilityRole="button" accessibilityLabel="Sell an item" onPress={() => root.navigate('SellItem')} style={{ flex: 1, alignItems: 'center', marginTop: -26 }}>
              <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: colors.sell, alignItems: 'center', justifyContent: 'center', borderWidth: 4, borderColor: '#fff', boxShadow: '0px 4px 12px rgba(194,65,12,0.4)' }}><Ionicons name="add" size={42} color="#fff" /></View>
              <Txt variant="tiny" bold color={colors.sell}>Sell</Txt>
            </Pressable>
          );
        }
        const focused = state.routes[state.index].name === r.name;
        const [on, off, label] = TAB_ICONS[r.name];
        return (
          <Pressable key={r.key} accessibilityRole="tab" accessibilityLabel={label} accessibilityState={{ selected: focused }} onPress={() => { if (!focused) navigation.navigate(r.name); }} style={{ flex: 1, alignItems: 'center', minHeight: 56, justifyContent: 'center', gap: 2 }}>
            <View>
              <Ionicons name={(focused ? on : off) as any} size={28} color={focused ? colors.primary : colors.sub} />
              {r.name === 'Messages' && badge ? <View style={{ position: 'absolute', top: -4, right: -10, minWidth: 22, height: 22, borderRadius: 11, backgroundColor: colors.danger, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}><Txt variant="tiny" bold color="#fff" style={{ lineHeight: 16 }}>{badge > 9 ? '9+' : badge}</Txt></View> : null}
            </View>
            <Txt variant="tiny" bold color={focused ? colors.primary : colors.sub}>{label}</Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function MainTabs() {
  return (
    <Tabs.Navigator tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, animation: 'fade' }}>
      <Tabs.Screen name="Home" component={Home} />
      <Tabs.Screen name="Explore" component={Explore} />
      <Tabs.Screen name="Messages" component={Messages} />
      <Tabs.Screen name="Profile" component={Profile} />
    </Tabs.Navigator>
  );
}

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, primary: colors.primary } };

export function RootNavigator() {
  const { ready, user, seenOnboarding } = useAuth();
  // Tapping a push notification opens the right screen (native only; a no-op on web).
  useEffect(() => {
    if (!user || user.needsProfile) return;
    return listenForNotificationTaps((data) => {
      const target = routeFor(data);
      if (target && navRef.isReady()) navRef.navigate(target[0], target[1]);
    });
  }, [user?.id, user?.needsProfile]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready) {
    return <View style={{ flex: 1, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', gap: 16 }}><Logo size={96} /><Txt variant="hero" color={colors.primary}>Connectly</Txt><Txt color={colors.sub}>Buy  •  Sell  •  Connect</Txt><Loading /></View>;
  }
  return (
    <NavigationContainer theme={theme} ref={navRef}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        {!seenOnboarding ? (
          <Stack.Screen name="Onboarding" component={Onboarding} />
        ) : !user ? (
          <>
            <Stack.Screen name="Welcome" component={Welcome} />
            <Stack.Screen name="PhoneSignIn" component={PhoneSignIn} />
            <Stack.Screen name="GoogleDev" component={GoogleDevSignIn} />
            <Stack.Screen name="Login" component={Login} />
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
