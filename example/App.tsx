import React, { useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import {
  ImeiSerialReader,
  ReaderType,
  type Frame,
  type ParserConfig,
} from 'react-native-imei-serial-reader';

const PICKER: { label: string; value: ReaderType }[] = [
  { label: 'IMEI', value: ReaderType.Imei },
  { label: 'Serial #', value: ReaderType.SerialNumber },
  { label: 'Flexible', value: ReaderType.FlexibleBarcode },
  { label: 'Exact', value: ReaderType.ExactMatch },
];

export default function App() {
  return (
    <SafeAreaProvider>
      <AppContent />
    </SafeAreaProvider>
  );
}

function AppContent() {
  const [readerType, setReaderType] = useState<ReaderType>(ReaderType.Imei);
  const [captureFrame, setCaptureFrame] = useState(false);
  const [customRegex, setCustomRegex] = useState('');
  const [targetBarcode, setTargetBarcode] = useState('');
  const [results, setResults] = useState<string[]>([]);
  const [frame, setFrame] = useState<Frame | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [viewerUri, setViewerUri] = useState<string | null>(null);

  const parserConfig: ParserConfig = useMemo(() => {
    if (readerType === ReaderType.FlexibleBarcode) {
      return {
        readerType,
        ...(customRegex.length > 0 ? { customRegex } : null),
      };
    }
    if (readerType === ReaderType.ExactMatch) {
      return { readerType, targetBarcode: targetBarcode || 'PLACEHOLDER' };
    }
    return { readerType };
  }, [readerType, customRegex, targetBarcode]);

  return (
    <SafeAreaView style={styles.fill}>
      <View style={styles.topBar}>
        {PICKER.map((p) => (
          <Pressable
            key={p.value}
            onPress={() => {
              setReaderType(p.value);
              setResults([]);
              setFrame(undefined);
              setError(null);
            }}
            style={[styles.tab, readerType === p.value && styles.tabActive]}
          >
            <Text style={styles.tabLabel}>{p.label}</Text>
          </Pressable>
        ))}
      </View>

      {readerType === ReaderType.FlexibleBarcode && (
        <TextInput
          style={styles.input}
          placeholder="Optional custom regex"
          placeholderTextColor="#888"
          value={customRegex}
          onChangeText={setCustomRegex}
          autoCapitalize="none"
        />
      )}
      {readerType === ReaderType.ExactMatch && (
        <TextInput
          style={styles.input}
          placeholder="Target barcode (required)"
          placeholderTextColor="#888"
          value={targetBarcode}
          onChangeText={setTargetBarcode}
          autoCapitalize="characters"
        />
      )}

      <View style={styles.captureToggle}>
        <Text style={styles.captureLabel}>Capture frame on match</Text>
        <Switch value={captureFrame} onValueChange={setCaptureFrame} />
      </View>

      <View style={styles.camera}>
        <ImeiSerialReader
          parserConfig={parserConfig}
          captureFrame={captureFrame}
          onDone={(values, f) => {
            setResults(values);
            setFrame(f);
          }}
          onError={(e) => setError(e.message)}
        />
      </View>

      <ScrollView style={styles.results} contentContainerStyle={styles.resultsInner}>
        <Text style={styles.resultsTitle}>Results</Text>
        {error != null && <Text style={styles.error}>{error}</Text>}
        {results.length === 0 && error == null && <Text style={styles.muted}>(none yet)</Text>}
        {results.map((r, i) => (
          <Text key={i} style={styles.resultLine}>
            {r}
          </Text>
        ))}
        {frame != null && (
          <View style={styles.thumbnailWrap}>
            <Text style={styles.muted}>
              {frame.width}×{frame.height} ({frame.orientation})
            </Text>
            <Pressable onPress={() => setViewerUri(frame.uri)}>
              <Image source={{ uri: frame.uri }} style={styles.thumbnail} resizeMode="contain" />
              <Text style={styles.tapHint}>Tap to view full screen</Text>
            </Pressable>
            <Text style={styles.path} numberOfLines={2}>
              {frame.uri}
            </Text>
          </View>
        )}
      </ScrollView>

      <Modal
        visible={viewerUri != null}
        transparent={false}
        animationType="fade"
        onRequestClose={() => setViewerUri(null)}
        statusBarTranslucent
      >
        <StatusBar barStyle="light-content" backgroundColor="#000" />
        <View style={styles.viewerRoot}>
          <Pressable style={styles.viewerImageWrap} onPress={() => setViewerUri(null)}>
            {viewerUri != null && (
              <Image
                source={{ uri: viewerUri }}
                style={styles.viewerImage}
                resizeMode="contain"
              />
            )}
          </Pressable>
          <Pressable style={styles.viewerClose} onPress={() => setViewerUri(null)} hitSlop={12}>
            <Text style={styles.viewerCloseLabel}>Close</Text>
          </Pressable>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: '#111' },
  topBar: { flexDirection: 'row', padding: 8, gap: 8 },
  tab: { flex: 1, padding: 8, backgroundColor: '#222', borderRadius: 6 },
  tabActive: { backgroundColor: '#2563eb' },
  tabLabel: { color: '#fff', textAlign: 'center', fontWeight: '600' },
  input: {
    marginHorizontal: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#222',
    color: '#fff',
    borderRadius: 6,
  },
  captureToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  captureLabel: { color: '#fff', fontSize: 14 },
  camera: { flex: 1, marginHorizontal: 8, borderRadius: 8, overflow: 'hidden' },
  results: { maxHeight: 220, marginTop: 8 },
  resultsInner: { padding: 12 },
  resultsTitle: { color: '#fff', fontWeight: '700', marginBottom: 4 },
  resultLine: { color: '#0f0', fontFamily: 'Courier', fontSize: 14 },
  muted: { color: '#888' },
  error: { color: '#f87171' },
  thumbnailWrap: { marginTop: 8 },
  thumbnail: { width: '100%', height: 160, marginTop: 4, backgroundColor: '#000' },
  tapHint: { color: '#60a5fa', fontSize: 12, marginTop: 4, textAlign: 'center' },
  path: { color: '#888', fontSize: 10, marginTop: 4 },
  viewerRoot: { flex: 1, backgroundColor: '#000' },
  viewerImageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewerImage: { width: '100%', height: '100%' },
  viewerClose: {
    position: 'absolute',
    top: 40,
    right: 16,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 20,
  },
  viewerCloseLabel: { color: '#fff', fontSize: 14, fontWeight: '600' },
});
