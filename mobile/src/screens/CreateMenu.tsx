import React from 'react';
import { useNavigation } from '@react-navigation/native';
import { Card, Header, Row, Screen, Txt } from '../ui';
import { colors } from '../theme';

/** What would you like to do? One door for the three ways to earn on Connectly. */
export function CreateMenu() {
  const nav = useNavigation<any>();
  const go = (route: string) => nav.replace(route);
  return (
    <Screen header={<Header title="Create" />}>
      <Txt color={colors.sub} style={{ marginBottom: 12 }}>Pick what suits you. You can do all three.</Txt>
      <Card style={{ paddingVertical: 6 }}>
        <Row icon="pricetag" label="Sell an item" value="List something for a fixed price" onPress={() => go('SellItem')} color={colors.sell} />
        <Row icon="hammer" label="Create an auction" value="Let verified bidders compete" onPress={() => go('AuctionCreate')} />
        <Row icon="storefront" label="Run a business" value="Billing, stock, books and an online shop" onPress={() => go('BizHub')} color={colors.buy} />
      </Card>
    </Screen>
  );
}
