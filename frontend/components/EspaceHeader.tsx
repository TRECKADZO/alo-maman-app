import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { SPACING } from "../constants/theme";

/** En-tête dégradé commun aux écrans « Mon espace & mes droits ». */
export default function EspaceHeader({ title, sub, colors = ["#C85A40", "#A855F7"] }: { title: string; sub?: string; colors?: [string, string] }) {
  const router = useRouter();
  return (
    <LinearGradient colors={colors} style={styles.header}>
      <TouchableOpacity onPress={() => router.back()} style={styles.backBtn} testID="header-back" accessibilityLabel="Retour">
        <Ionicons name="chevron-back" size={22} color="#fff" />
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {sub ? <Text style={styles.sub}>{sub}</Text> : null}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", gap: 10, padding: SPACING.lg, paddingBottom: 18, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  backBtn: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(255,255,255,0.25)", alignItems: "center", justifyContent: "center" },
  title: { color: "#fff", fontSize: 20, fontWeight: "800" },
  sub: { color: "rgba(255,255,255,0.88)", fontSize: 12, marginTop: 2 },
});
