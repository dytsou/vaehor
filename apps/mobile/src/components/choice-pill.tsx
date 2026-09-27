import { Pressable, StyleSheet, Text } from "react-native";

export function ChoicePill({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.choice, selected && styles.selected]}
      onPress={onPress}
    >
      <Text style={[styles.text, selected && styles.selectedText]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  choice: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  selected: { backgroundColor: "#1f6f78", borderColor: "#1f6f78" },
  text: { color: "#334155", fontSize: 13, fontWeight: "600" },
  selectedText: { color: "#ffffff" },
});
