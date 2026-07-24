type SetupTokenFieldProps = {
  setupToken: string;
  onSetupTokenChange: (value: string) => void;
  label: string;
  placeholder: string;
  hint: string;
};

export function SetupTokenField({
  setupToken,
  onSetupTokenChange,
  label,
  placeholder,
  hint,
}: Readonly<SetupTokenFieldProps>) {
  return (
    <div className="mb-6 rounded-xl border border-border bg-muted/20 p-4 space-y-2">
      <label className="text-sm font-medium" htmlFor="setup-token">
        {label}
      </label>
      <input
        id="setup-token"
        type="password"
        autoComplete="off"
        value={setupToken}
        onChange={(e) => onSetupTokenChange(e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        placeholder={placeholder}
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
