import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import JSZip from 'jszip';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Chapter {
  content: string;
  title?: string;
}

export default function App(): React.JSX.Element {
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [chapters, setChapters] = useState<string[]>([]);
  const [currentChapter, setCurrentChapter] = useState<number>(0);

  useEffect(() => {
    loadEpub();
  }, []);

  const loadEpub = async (): Promise<void> => {
    try {
      setLoading(true);
      
      // Load EPUB from assets
      // Replace 'sample.epub' with your actual epub filename in assets folder
      const asset: Asset = Asset.fromModule(require('../assets/books/steinbeck-of-mice-and-men.epub'));
      await asset.downloadAsync();
      
      const fileUri: string = asset.localUri || asset.uri;
      
      // Use the new File API in SDK 54
      const file = new File(fileUri);
      const base64: string = await file.base64();
      
      // Unzip EPUB
      const zip: JSZip = await JSZip.loadAsync(base64, { base64: true });
      
      // Parse EPUB structure
      const containerFile = zip.file('META-INF/container.xml');
      if (!containerFile) {
        throw new Error('Invalid EPUB: Missing container.xml');
      }
      
      const containerXml: string = await containerFile.async('string');
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
      if (!opfPathMatch) {
        throw new Error('Invalid EPUB: Cannot find OPF path');
      }
      
      const opfPath: string = opfPathMatch[1];
      const opfFile = zip.file(opfPath);
      if (!opfFile) {
        throw new Error('Invalid EPUB: Missing OPF file');
      }
      
      const opfContent: string = await opfFile.async('string');
      
      // Extract chapter references
      const itemRefs: RegExpMatchArray | null = opfContent.match(/<itemref[^>]*idref="([^"]+)"/g);
      const chapterIds: string[] = itemRefs 
        ? itemRefs.map((ref: string) => {
            const match = ref.match(/idref="([^"]+)"/);
            return match ? match[1] : '';
          }).filter(Boolean)
        : [];
      
      // Get chapter files
      const items: RegExpMatchArray | null = opfContent.match(/<item[^>]*>/g);
      const chapterFiles: string[] = [];
      
      if (items) {
        chapterIds.forEach((id: string) => {
          const item = items.find((i: string) => i.includes(`id="${id}"`));
          if (item) {
            const hrefMatch = item.match(/href="([^"]+)"/);
            if (hrefMatch) {
              const href: string = hrefMatch[1];
              const basePath: string = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
              chapterFiles.push(basePath + href);
            }
          }
        });
      }
      
      // Load all chapters
      const loadedChapters: string[] = [];
      for (const file of chapterFiles) {
        try {
          const chapterFile = zip.file(file);
          if (chapterFile) {
            const html: string = await chapterFile.async('string');
            const text: string = extractTextFromHtml(html);
            if (text.trim()) {
              loadedChapters.push(text);
            }
          }
        } catch (e) {
          console.log('Error loading chapter:', e);
        }
      }
      
      setChapters(loadedChapters);
      setContent(loadedChapters[0] || 'No content found');
      setLoading(false);
    } catch (err) {
      console.error('Error loading EPUB:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError('Failed to load EPUB: ' + errorMessage);
      setLoading(false);
    }
  };

  const extractTextFromHtml = (html: string): string => {
    // Remove script and style tags
    let text: string = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    
    // Convert common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    
    // Replace paragraph tags with newlines
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/div>/gi, '\n');
    text = text.replace(/<\/h[1-6]>/gi, '\n\n');
    
    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');
    
    // Clean up whitespace
    text = text.replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    
    return text;
  };

  const nextChapter = (): void => {
    if (currentChapter < chapters.length - 1) {
      const next: number = currentChapter + 1;
      setCurrentChapter(next);
      setContent(chapters[next]);
    }
  };

  const previousChapter = (): void => {
    if (currentChapter > 0) {
      const prev: number = currentChapter - 1;
      setCurrentChapter(prev);
      setContent(chapters[prev]);
    }
  };

  if (loading) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#007AFF" />
        <Text style={styles.loadingText}>Loading EPUB...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <Text style={styles.errorHint}>
          Make sure you have 'sample.epub' in your assets folder and jszip installed
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>EPUB Reader</Text>
        <Text style={styles.headerSubtitle}>
          Chapter {currentChapter + 1} of {chapters.length}
        </Text>
      </View>

      {/* Content */}
      <ScrollView style={styles.scrollView}>
        <Text style={styles.contentText}>{content}</Text>
      </ScrollView>

      {/* Navigation */}
      <View style={styles.navigation}>
        <TouchableOpacity
          onPress={previousChapter}
          disabled={currentChapter === 0}
          style={[
            styles.navButton,
            currentChapter === 0 && styles.navButtonDisabled
          ]}
        >
          <Text style={styles.navButtonText}>← Previous</Text>
        </TouchableOpacity>
        
        <View style={styles.navDivider} />
        
        <TouchableOpacity
          onPress={nextChapter}
          disabled={currentChapter === chapters.length - 1}
          style={[
            styles.navButton,
            currentChapter === chapters.length - 1 && styles.navButtonDisabled
          ]}
        >
          <Text style={styles.navButtonText}>Next →</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#666',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  errorText: {
    fontSize: 18,
    color: '#d32f2f',
    textAlign: 'center',
  },
  errorHint: {
    marginTop: 16,
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 16,
    paddingHorizontal: 16,
    backgroundColor: '#007AFF',
    borderBottomWidth: 1,
    borderBottomColor: '#0051D5',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#E3F2FF',
    marginTop: 4,
  },
  scrollView: {
    flex: 1,
    padding: 20,
  },
  contentText: {
    fontSize: 16,
    lineHeight: 26,
    color: '#333',
  },
  navigation: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    backgroundColor: '#f8f8f8',
  },
  navButton: {
    flex: 1,
    padding: 16,
    alignItems: 'center',
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navButtonText: {
    fontSize: 16,
    color: '#007AFF',
    fontWeight: '600',
  },
  navDivider: {
    width: 1,
    backgroundColor: '#e0e0e0',
  },
});