import React from 'react';
import { View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { api } from '../api';
import { useAuth } from '../context';
import { useLoad } from '../hooks';
import { Avatar, Button, Card, Header, Row, Screen, SectionTitle, Stars, Txt, confirmDialog, Pill } from '../ui';
import { colors } from '../theme';
import { Listing } from '../types';
import { ListingGrid } from '../components/ListingCard';

const Stat = ({ value, label }: { value: string | number; label: string }) => (
  <View style={{ flex: 1, alignItems: 'center' }}><Txt variant="h2">{value}</Txt><Txt variant="tiny" color={colors.sub}>{label}</Txt></View>
);

export function Profile() {
  const nav = useNavigation<any>();
  const { user, signOut, refresh } = useAuth();
  const mine = useLoad(async () => { void refresh(); return api<{ listings: Listing[] }>('/me/listings'); }, []);
  if (!user) return null;
  const listings = mine.data?.listings || [];
  const logout = async () => { if (await confirmDialog('Log out?', 'You can log back in any time.', 'Log out')) await signOut(); };

  return (
    <Screen header={<Header title="My profile" back={false} />} refresh={{ refreshing: mine.refreshing, onRefresh: mine.refresh }}>
      <Card style={{ alignItems: 'center', gap: 8 }}>
        <Avatar name={user.name} uri={user.avatar} size={92} />
        <Txt variant="title" center>{user.name}</Txt>
        <Txt color={colors.sub}>{user.city}{user.email ? ` · ${user.email}` : ''}</Txt>
        {user.verified ? <Pill text="Verified profile" icon="shield-checkmark" color={colors.buy} bg={colors.buySoft} /> : null}
        {user.isBrand ? <Pill text={`Brand · ${user.brandName}`} icon="storefront" /> : null}
        {user.reviewCount ? <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><Stars rating={user.rating} /><Txt variant="small" color={colors.sub}>({user.reviewCount})</Txt></View> : null}
        <View style={{ flexDirection: 'row', width: '100%', marginTop: 8 }}>
          <Stat value={user.listingCount} label="Listings" /><Stat value={user.reviewCount ? user.rating : '—'} label="Rating" /><Stat value={user.connectionCount} label="Connections" />
        </View>
        <Button title="Edit profile" icon="create" variant="secondary" onPress={() => nav.navigate('EditProfile')} style={{ alignSelf: 'stretch', marginTop: 8 }} />
      </Card>

      <SectionTitle title="My listings" action={listings.length ? 'See all' : undefined} onAction={() => nav.navigate('MyListings')} />
      {listings.length ? <ListingGrid items={listings.slice(0, 2)} onOpen={(l) => nav.navigate('ItemDetails', { id: l.id })} /> :
        <Card><Txt color={colors.sub} style={{ marginBottom: 12 }}>You have not listed anything yet.</Txt><Button title="Sell your first item" variant="sell" icon="pricetag" onPress={() => nav.navigate('SellItem')} /></Card>}

      <Card style={{ marginTop: 20, paddingVertical: 6 }}>
        <Row icon="gift" label="Invite friends and family" value="Bring your people to Connectly" onPress={() => nav.navigate('Invite')} />
        <Row icon="receipt" label="My orders" value="Things you bought and sold" onPress={() => nav.navigate('Orders')} />
        <Row icon="heart" label="Saved items" onPress={() => nav.navigate('Favorites')} />
        <Row icon="people" label="My connections" onPress={() => nav.navigate('Connect')} />
        <Row icon="storefront" label={user.isBrand ? 'Brand hub' : 'Selling as a business?'} value={user.isBrand ? user.brandName : 'Brand partners: ads and more'} onPress={() => nav.navigate('BrandHub')} />
        <Row icon="settings" label="Settings and text size" onPress={() => nav.navigate('Settings')} />
        <Row icon="shield-checkmark" label="Trust and safety" onPress={() => nav.navigate('Safety')} />
        <Row icon="log-out" label="Log out" danger onPress={logout} />
      </Card>
    </Screen>
  );
}
