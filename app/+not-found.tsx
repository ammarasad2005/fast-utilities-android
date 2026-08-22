import { Link, Stack } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { useStyles, type ThemeColors } from '@/theme/ThemeContext';

export default function NotFoundScreen() {
  const styles = useStyles(makeStyles);
  return (
    <>
      <Stack.Screen options={{ title: 'Not found' }} />
      <View style={styles.container}>
        <Text style={styles.title}>This screen was not found.</Text>
        <Link href="/" style={styles.link}>
          <Text style={styles.linkText}>Go back home</Text>
        </Link>
      </View>
    </>
  );
}

const makeStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20, backgroundColor: colors.bg },
    title: { fontSize: 20, fontWeight: '700', color: colors.text },
    link: { marginTop: 16 },
    linkText: { color: colors.brand, fontWeight: '600' },
  });
