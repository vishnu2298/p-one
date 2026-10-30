import React from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Providers } from './src/context';
import { RootNavigator } from './src/navigation';
import { ToastHost } from './src/ui';

export default function App() {
  const content = (
    <SafeAreaProvider>
      <Providers>
        <StatusBar style="dark" />
        <RootNavigator />
        <ToastHost />
      </Providers>
    </SafeAreaProvider>
  );
  // On the web, present the app as a centred phone-width column.
  if (Platform.OS === 'web') {
    return <View style={{ flex: 1, backgroundColor: '#E4EAF2', alignItems: 'center' }}><View style={{ flex: 1, width: '100%', maxWidth: 480, backgroundColor: '#fff', overflow: 'hidden' }}>{content}</View></View>;
  }
  return content;
}
