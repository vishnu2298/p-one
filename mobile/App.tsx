import React from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Providers } from './src/context';
import { RootNavigator } from './src/navigation';
import { ToastHost, Button, Txt } from './src/ui';
import { OfflineBanner } from './src/motion';

// Last line of defence: a friendly screen instead of a blank crash.
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(e: unknown) { console.error('App crashed:', e); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14, backgroundColor: '#fff' }}>
        <Txt variant="title" center>Oops, something went wrong</Txt>
        <Txt center color="#475467">Please try again. Your information is safe.</Txt>
        <Button title="Try again" onPress={() => this.setState({ failed: false })} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }
}

export default function App() {
  const content = (
    <SafeAreaProvider>
      <Providers>
        <StatusBar style="dark" />
        <ErrorBoundary><RootNavigator /></ErrorBoundary>
        <ToastHost />
        <OfflineBanner />
      </Providers>
    </SafeAreaProvider>
  );
  // On the web, present the app as a centred phone-width column.
  if (Platform.OS === 'web') {
    return <View style={{ flex: 1, backgroundColor: '#E4EAF2', alignItems: 'center' }}><View style={{ flex: 1, width: '100%', maxWidth: 480, backgroundColor: '#fff', overflow: 'hidden' }}>{content}</View></View>;
  }
  return content;
}
