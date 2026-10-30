import React from 'react';
import { View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { api } from '../api';
import { useLoad } from '../hooks';
import { Button, Card, ErrorState, FadeIn, Header, Screen, SkeletonRows, Txt } from '../ui';
import { colors } from '../theme';

type Doc = { title: string; version: string; sections: { heading: string; text: string }[] };
const DOCS = [['terms', 'Terms of Use'], ['privacy', 'Privacy Policy'], ['grievance', 'Grievance Officer']] as const;

/** Terms of Use, Privacy Policy and Grievance Officer, served by the API so they can be edited without a new app release. */
export function Legal() {
  const nav = useNavigation<any>();
  const doc = (useRoute().params as any)?.doc || 'terms';
  const res = useLoad(() => api<Doc>(`/legal/${doc}?format=json`), [doc]);
  return (
    <Screen header={<Header title={res.data?.title || 'Terms and policies'} />}>
      {res.loading && !res.data ? <SkeletonRows count={3} avatar={false} /> : res.error && !res.data ? <ErrorState message={res.error} retry={() => res.reload()} /> : res.data ? (
        <FadeIn>
          <Txt variant="tiny" color={colors.sub} style={{ marginBottom: 8 }}>Version {res.data.version}</Txt>
          <View style={{ gap: 12 }}>
            {res.data.sections.map((s) => <Card key={s.heading} style={{ gap: 6 }}><Txt variant="h2">{s.heading}</Txt><Txt>{s.text}</Txt></Card>)}
          </View>
          <View style={{ gap: 8, marginTop: 20 }}>
            {DOCS.filter(([id]) => id !== doc).map(([id, label]) => <Button key={id} title={label} variant="light" onPress={() => nav.replace('Legal', { doc: id })} />)}
          </View>
        </FadeIn>
      ) : null}
    </Screen>
  );
}
