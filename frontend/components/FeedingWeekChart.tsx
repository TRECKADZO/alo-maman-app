/**
 * Graphique hebdomadaire des tétées : nombre de tétées (pastille) et durée totale (barre) par jour,
 * sur les 7 derniers jours. Filtre par enfant si plusieurs.
 */
import { useMemo, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { COLORS, RADIUS } from "../constants/theme";

const JOURS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export default function FeedingWeekChart({ items, enfants }: { items: any[]; enfants: any[] }) {
  const [enfantId, setEnfantId] = useState<string | null>(null);

  const { days, totalCount, totalMin, maxMin } = useMemo(() => {
    const today = new Date();
    const list = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - (6 - i));
      return { key: dayKey(d), label: i === 6 ? "Auj." : JOURS[d.getDay()], count: 0, minutes: 0 };
    });
    const idx = Object.fromEntries(list.map((d, i) => [d.key, i]));
    for (const a of items) {
      if (enfantId && a.enfant_id !== enfantId) continue;
      const d = new Date(a.date);
      if (isNaN(d.getTime())) continue;
      const i = idx[dayKey(d)];
      if (i === undefined) continue;
      list[i].count += 1;
      list[i].minutes += Number(a.duree_minutes) || 0;
    }
    return {
      days: list,
      totalCount: list.reduce((s, d) => s + d.count, 0),
      totalMin: list.reduce((s, d) => s + d.minutes, 0),
      maxMin: Math.max(1, ...list.map((d) => d.minutes)),
    };
  }, [items, enfantId]);

  return (
    <View style={styles.card} testID="feeding-week-chart">
      <Text style={styles.title}>📊 Cette semaine</Text>
      {enfants.length > 1 && (
        <View style={styles.chips}>
          {[{ id: null, nom: "Tous" }, ...enfants].map((e: any) => (
            <TouchableOpacity key={e.id ?? "all"} onPress={() => setEnfantId(e.id)} style={[styles.chip, enfantId === e.id && styles.chipOn]} testID={`feed-chip-${e.id ?? "all"}`}>
              <Text style={[styles.chipText, enfantId === e.id && { color: "#fff" }]}>{e.nom}</Text>
            </TouchableOpacity>
          ))}
        </View>
      )}
      <View style={styles.stats}>
        <Stat v={totalCount} l="tétées" />
        <Stat v={(totalCount / 7).toFixed(1)} l="par jour" />
        <Stat v={totalCount ? Math.round(totalMin / totalCount) : 0} l="min / tétée" />
      </View>
      <View style={styles.chart}>
        {days.map((d) => (
          <View key={d.key} style={styles.col}>
            <Text style={styles.min}>{d.minutes ? `${d.minutes}′` : ""}</Text>
            <View style={styles.track}>
              <View style={[styles.bar, { height: `${(d.minutes / maxMin) * 100}%` }]} />
            </View>
            <View style={[styles.countDot, !d.count && { backgroundColor: COLORS.border }]}>
              <Text style={styles.countText}>{d.count}</Text>
            </View>
            <Text style={[styles.day, d.label === "Auj." && { color: COLORS.primary, fontWeight: "800" }]}>{d.label}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.legend}>Barre = durée totale (min) · Pastille = nombre de tétées</Text>
    </View>
  );
}

function Stat({ v, l }: { v: any; l: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statV}>{v}</Text>
      <Text style={styles.statL}>{l}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: COLORS.surface, borderRadius: RADIUS.md, borderWidth: 1, borderColor: COLORS.border, padding: 14, marginBottom: 14 },
  title: { fontSize: 15, fontWeight: "800", color: COLORS.textPrimary },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 10 },
  chip: { paddingHorizontal: 12, minHeight: 32, justifyContent: "center", borderRadius: 999, borderWidth: 1, borderColor: COLORS.border },
  chipOn: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  chipText: { fontSize: 12, fontWeight: "700", color: COLORS.textPrimary },
  stats: { flexDirection: "row", gap: 8, marginTop: 12 },
  stat: { flex: 1, alignItems: "center", paddingVertical: 8, borderRadius: RADIUS.sm, backgroundColor: COLORS.bgSecondary },
  statV: { fontSize: 18, fontWeight: "900", color: COLORS.primary },
  statL: { fontSize: 11, color: COLORS.textSecondary },
  chart: { flexDirection: "row", alignItems: "flex-end", marginTop: 14 },
  col: { flex: 1, alignItems: "center" },
  min: { fontSize: 10, color: COLORS.textSecondary, height: 14 },
  track: { width: 18, height: 110, justifyContent: "flex-end", borderRadius: 6, backgroundColor: COLORS.bgSecondary, overflow: "hidden" },
  bar: { width: "100%", borderRadius: 6, backgroundColor: COLORS.primary },
  countDot: { marginTop: 6, minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", backgroundColor: "#EC4899" },
  countText: { fontSize: 11, fontWeight: "800", color: "#fff" },
  day: { fontSize: 11, color: COLORS.textSecondary, marginTop: 4 },
  legend: { fontSize: 11, color: COLORS.textMuted, textAlign: "center", marginTop: 10 },
});
