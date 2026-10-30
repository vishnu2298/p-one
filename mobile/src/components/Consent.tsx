import React from 'react';
import { Pressable, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Txt } from '../ui';
import { colors, radius } from '../theme';
import { useAuth } from '../context';
import { translate } from '../i18n';

/** DPDP Act: explicit, unticked-by-default consent with links to the Terms and Privacy Policy. */
export function ConsentCheck({ error }: { error?: boolean }) {
  const { consent, setConsent } = useAuth();
  const nav = useNavigation<any>();
  return (
    <Pressable accessibilityRole="checkbox" accessibilityLabel={translate('I agree to the Terms of Use and Privacy Policy')} accessibilityState={{ checked: consent }} onPress={() => setConsent(!consent)}
      style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start', padding: 14, borderRadius: radius.md, backgroundColor: colors.glass, borderWidth: 2, borderColor: error && !consent ? colors.danger : consent ? colors.primary : colors.line }}>
      <Ionicons name={consent ? 'checkbox' : 'square-outline'} size={34} color={consent ? colors.primary : colors.sub} />
      <View style={{ flex: 1 }}>
        <Txt variant="small">
          {translate('I agree to the')}{' '}
          <Txt variant="small" bold color={colors.primary} onPress={() => nav.navigate('Legal', { doc: 'terms' })}>{translate('Terms of Use')}</Txt>
          {' & '}
          <Txt variant="small" bold color={colors.primary} onPress={() => nav.navigate('Legal', { doc: 'privacy' })}>{translate('Privacy Policy')}</Txt>
        </Txt>
        {error && !consent ? <Txt variant="tiny" color={colors.danger} style={{ marginTop: 4 }}>Please tick the box to agree before continuing</Txt> : null}
      </View>
    </Pressable>
  );
}
