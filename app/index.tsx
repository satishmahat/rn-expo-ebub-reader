import { Ionicons } from '@expo/vector-icons';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import JSZip from 'jszip';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useColorScheme as useRNColorScheme,
} from 'react-native';

interface BookMetadata {
  title: string;
  author: string;
  coverImage: string | null;
}

interface Chapter {
  content: string;
  title: string;
}

export default function App(): React.JSX.Element {
  const systemColorScheme = useRNColorScheme();
  const [colorScheme, setColorScheme] = useState<'light' | 'dark'>(systemColorScheme || 'light');
  const [metadata, setMetadata] = useState<BookMetadata>({ title: 'Loading...', author: '', coverImage: null });
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [currentChapter, setCurrentChapter] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [fontSize, setFontSize] = useState<number>(16);

  const isDark = colorScheme === 'dark';
  const theme = {
    background: isDark ? '#1a1a1a' : '#ffffff',
    surface: isDark ? '#2a2a2a' : '#f8f9fa',
    text: isDark ? '#e0e0e0' : '#1a1a1a',
    textSecondary: isDark ? '#a0a0a0' : '#666666',
    primary: isDark ? '#4dabf7' : '#007AFF',
    border: isDark ? '#3a3a3a' : '#e0e0e0',
    headerBg: isDark ? '#2a2a2a' : '#007AFF',
    headerText: isDark ? '#e0e0e0' : '#ffffff',
  };

  useEffect(() => {
    loadEpub();
  }, []);

  const loadEpub = async (): Promise<void> => {
    try {
      setLoading(true);

      const asset: Asset = Asset.fromModule(
        require('../assets/books/steinbeck-of-mice-and-men.epub')
      );
      await asset.downloadAsync();

      const fileUri: string = asset.localUri || asset.uri;
      const file = new File(fileUri);
      const base64: string = await file.base64();

      const zip: JSZip = await JSZip.loadAsync(base64, { base64: true });

      // Parse container.xml
      const containerFile = zip.file('META-INF/container.xml');
      if (!containerFile) throw new Error('Invalid EPUB: Missing container.xml');

      const containerXml: string = await containerFile.async('string');
      const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
      if (!opfPathMatch) throw new Error('Invalid EPUB: Cannot find OPF path');

      const opfPath: string = opfPathMatch[1];
      const opfDir = opfPath.substring(0, opfPath.lastIndexOf('/') + 1);
      const opfFile = zip.file(opfPath);
      if (!opfFile) throw new Error('Invalid EPUB: Missing OPF file');

      const opfContent: string = await opfFile.async('string');

      // Extract metadata
      const bookMetadata = await extractMetadata(opfContent, zip, opfDir);
      setMetadata(bookMetadata);

      // Extract chapters with titles
      const bookChapters = await extractChapters(opfContent, zip, opfDir);
      setChapters(bookChapters);

      setLoading(false);
    } catch (err) {
      console.error('Error loading EPUB:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError('Failed to load EPUB: ' + errorMessage);
      setLoading(false);
    }
  };

  const extractMetadata = async (
    opfContent: string,
    zip: JSZip,
    opfDir: string
  ): Promise<BookMetadata> => {
    // Extract title
    const titleMatch = opfContent.match(/<dc:title[^>]*>(.*?)<\/dc:title>/i);
    const title = titleMatch ? titleMatch[1].trim() : 'Unknown Title';

    // Extract author
    const authorMatch = opfContent.match(/<dc:creator[^>]*>(.*?)<\/dc:creator>/i);
    const author = authorMatch ? authorMatch[1].trim() : 'Unknown Author';

    // Extract cover image - try multiple methods
    let coverImage: string | null = null;
    let coverId: string | null = null;

    // Method 1: EPUB 2 style - <meta name="cover" content="cover-id"/>
    // Handle both attribute orderings
    const coverMatch1 = opfContent.match(/<meta[^>]*name="cover"[^>]*content="([^"]+)"/i);
    const coverMatch2 = opfContent.match(/<meta[^>]*content="([^"]+)"[^>]*name="cover"/i);
    
    if (coverMatch1) {
      coverId = coverMatch1[1];
    } else if (coverMatch2) {
      coverId = coverMatch2[1];
    }

    // Method 2: EPUB 3 style - <item properties="cover-image" href="..."/>
    if (!coverId) {
      const epub3CoverMatch = opfContent.match(/<item[^>]*properties="cover-image"[^>]*href="([^"]+)"/i);
      const epub3CoverMatch2 = opfContent.match(/<item[^>]*href="([^"]+)"[^>]*properties="cover-image"/i);
      
      if (epub3CoverMatch) {
        const coverHref = epub3CoverMatch[1];
        const coverPath = opfDir + coverHref;
        const coverFile = zip.file(coverPath);
        
        if (coverFile) {
          const coverData = await coverFile.async('base64');
          const ext = coverHref.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
          coverImage = `data:${mimeType};base64,${coverData}`;
        }
      } else if (epub3CoverMatch2) {
        const coverHref = epub3CoverMatch2[1];
        const coverPath = opfDir + coverHref;
        const coverFile = zip.file(coverPath);
        
        if (coverFile) {
          const coverData = await coverFile.async('base64');
          const ext = coverHref.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
          coverImage = `data:${mimeType};base64,${coverData}`;
        }
      }
    }
    
    // If we found a cover ID, look it up in the manifest
    if (coverId && !coverImage) {
      // Try both attribute orderings for item lookup
      const coverItemMatch1 = opfContent.match(
        new RegExp(`<item[^>]*id="${coverId}"[^>]*href="([^"]+)"`, 'i')
      );
      const coverItemMatch2 = opfContent.match(
        new RegExp(`<item[^>]*href="([^"]+)"[^>]*id="${coverId}"`, 'i')
      );
      
      const coverHref = coverItemMatch1?.[1] || coverItemMatch2?.[1];
      
      if (coverHref) {
        const coverPath = opfDir + coverHref;
        const coverFile = zip.file(coverPath);
        
        if (coverFile) {
          const coverData = await coverFile.async('base64');
          const ext = coverHref.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png';
          coverImage = `data:${mimeType};base64,${coverData}`;
        }
      }
    }

    return { title, author, coverImage };
  };

  const extractChapters = async (
    opfContent: string,
    zip: JSZip,
    opfDir: string
  ): Promise<Chapter[]> => {
    // Get spine items (reading order)
    const itemRefs: RegExpMatchArray | null = opfContent.match(
      /<itemref[^>]*idref="([^"]+)"/g
    );
    const chapterIds: string[] = itemRefs
      ? itemRefs.map((ref: string) => {
          const match = ref.match(/idref="([^"]+)"/);
          return match ? match[1] : '';
        }).filter(Boolean)
      : [];

    // Get manifest items
    const items: RegExpMatchArray | null = opfContent.match(/<item[^>]*>/g);
    const loadedChapters: Chapter[] = [];

    if (items) {
      for (const id of chapterIds) {
        try {
          const item = items.find((i: string) => i.includes(`id="${id}"`));
          if (item) {
            const hrefMatch = item.match(/href="([^"]+)"/);
            if (hrefMatch) {
              const href: string = hrefMatch[1];
              const chapterPath = opfDir + href;
              const chapterFile = zip.file(chapterPath);

              if (chapterFile) {
                const html: string = await chapterFile.async('string');
                const chapterTitle = extractTitle(html);
                const text: string = extractTextFromHtml(html, chapterTitle);

                if (text.trim()) {
                  loadedChapters.push({
                    title: chapterTitle,
                    content: text,
                  });
                }
              }
            }
          }
        } catch (e) {
          console.log('Error loading chapter:', e);
        }
      }
    }

    return loadedChapters;
  };

  const extractTitle = (html: string): string => {
    // Try to extract title from h1, h2, or title tag
    const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
    if (h1Match) {
      return h1Match[1].replace(/<[^>]+>/g, '').trim();
    }

    const h2Match = html.match(/<h2[^>]*>(.*?)<\/h2>/i);
    if (h2Match) {
      return h2Match[1].replace(/<[^>]+>/g, '').trim();
    }

    const titleMatch = html.match(/<title[^>]*>(.*?)<\/title>/i);
    if (titleMatch) {
      return titleMatch[1].replace(/<[^>]+>/g, '').trim();
    }

    return 'Chapter';
  };

  const extractTextFromHtml = (html: string, titleToRemove?: string): string => {
    let text: string = html;

    // Remove everything before <body> and after </body>
    const bodyMatch = text.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
    if (bodyMatch) {
      text = bodyMatch[1];
    }

    // Remove script, style, header, footer tags
    text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
    text = text.replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');
    text = text.replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '');

    // Remove the titlepage div which contains the chapter title
    text = text.replace(/<div\s+class="titlepage"[^>]*>[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/gi, '');
    
    // Also remove any standalone h1/h2 title tags that might contain the title
    if (titleToRemove) {
      const escapedTitle = titleToRemove.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      text = text.replace(new RegExp(`<h[1-6][^>]*>\\s*${escapedTitle}\\s*<\\/h[1-6]>`, 'gi'), '');
    }

    // Remove section and div wrappers but keep content
    text = text.replace(/<section[^>]*>/gi, '');
    text = text.replace(/<\/section>/gi, '');
    text = text.replace(/<div[^>]*>/gi, '');
    text = text.replace(/<\/div>/gi, '');

    // IMPORTANT: First normalize all whitespace within the HTML
    // Replace newlines and multiple spaces with single space (source formatting)
    text = text.replace(/[\r\n]+/g, ' ');
    text = text.replace(/\s+/g, ' ');

    // Handle lists - each list item on a new line
    // First, handle nested lists by adding extra indentation marker
    text = text.replace(/<ol[^>]*>\s*<li/gi, '<ol><li');
    text = text.replace(/<ul[^>]*>\s*<li/gi, '<ul><li');
    
    // Add line breaks before each list item
    text = text.replace(/<li[^>]*>/gi, '\n• ');
    text = text.replace(/<\/li>/gi, '');
    
    // Remove list wrapper tags
    text = text.replace(/<\/?ol[^>]*>/gi, '\n');
    text = text.replace(/<\/?ul[^>]*>/gi, '\n');
    text = text.replace(/<\/?nav[^>]*>/gi, '');

    // Handle anchor tags - extract text content
    text = text.replace(/<a[^>]*>(.*?)<\/a>/gi, '$1');

    // Now handle block elements - add proper paragraph breaks
    text = text.replace(/<\/p>\s*<p[^>]*>/gi, '\n\n');
    text = text.replace(/<\/p>/gi, '\n\n');
    text = text.replace(/<p[^>]*>/gi, '');
    
    // Handle line breaks
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Convert common HTML entities
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/&apos;/g, "'");
    text = text.replace(/&mdash;/g, '—');
    text = text.replace(/&ndash;/g, '–');
    text = text.replace(/&hellip;/g, '…');
    text = text.replace(/&rsquo;/g, "'");
    text = text.replace(/&lsquo;/g, "'");
    text = text.replace(/&rdquo;/g, '"');
    text = text.replace(/&ldquo;/g, '"');

    // Remove remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Clean up whitespace while preserving line structure
    // Split by lines, clean each line, then rejoin
    const lines = text.split('\n');
    text = lines
      .map(line => line.trim().replace(/\s+/g, ' '))
      .join('\n');
    
    // Reduce multiple consecutive newlines to max 2 (paragraph break)
    text = text.replace(/\n{3,}/g, '\n\n');
    
    // Remove empty lines that only have bullet points
    text = text.replace(/\n•\s*\n/g, '\n');
    
    // Clean up any remaining empty lines
    text = text.replace(/\n\s*\n\s*\n/g, '\n\n');

    return text.trim();
  };

  const nextChapter = (): void => {
    if (currentChapter < chapters.length - 1) {
      setCurrentChapter(currentChapter + 1);
    }
  };

  const previousChapter = (): void => {
    if (currentChapter > 0) {
      setCurrentChapter(currentChapter - 1);
    }
  };

  const increaseFontSize = (): void => {
    if (fontSize < 32) setFontSize(fontSize + 2);
  };

  const decreaseFontSize = (): void => {
    if (fontSize > 12) setFontSize(fontSize - 2);
  };

  const toggleTheme = (): void => {
    setColorScheme(isDark ? 'light' : 'dark');
  };

  if (loading) {
    return (
      <View style={[styles.centerContainer, { backgroundColor: theme.background }]}>
        <ActivityIndicator size="large" color={theme.primary} />
        <Text style={[styles.loadingText, { color: theme.textSecondary }]}>
          Loading EPUB...
        </Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.errorContainer, { backgroundColor: theme.background }]}>
        <Ionicons name="alert-circle" size={64} color="#d32f2f" />
        <Text style={[styles.errorText, { color: '#d32f2f' }]}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadEpub}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const currentChapterData = chapters[currentChapter];

  return (
    <View style={[styles.container, { backgroundColor: theme.background }]}>
      {/* Header */}
      <View style={[styles.header, { backgroundColor: theme.headerBg, borderBottomColor: theme.border }]}>
        <View style={styles.headerTop}>
          {metadata.coverImage && (
            <Image source={{ uri: metadata.coverImage }} style={styles.coverThumbnail} />
          )}
          <View style={styles.headerInfo}>
            <Text style={[styles.headerTitle, { color: theme.headerText }]} numberOfLines={1}>
              {metadata.title}
            </Text>
            {metadata.author && (
              <Text style={[styles.headerAuthor, { color: theme.headerText, opacity: 0.8 }]} numberOfLines={1}>
                by {metadata.author}
              </Text>
            )}
            <Text style={[styles.headerProgress, { color: theme.headerText, opacity: 0.7 }]}>
              {currentChapter + 1} / {chapters.length}
            </Text>
          </View>
        </View>
      </View>

      {/* Controls Bar */}
      <View style={[styles.controlsBar, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        <View style={styles.fontControls}>
          <TouchableOpacity onPress={decreaseFontSize} style={styles.controlButton}>
            <Ionicons name="remove-circle-outline" size={24} color={theme.primary} />
          </TouchableOpacity>
          <Text style={[styles.fontSizeLabel, { color: theme.textSecondary }]}>
            {fontSize}px
          </Text>
          <TouchableOpacity onPress={increaseFontSize} style={styles.controlButton}>
            <Ionicons name="add-circle-outline" size={24} color={theme.primary} />
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={toggleTheme} style={styles.controlButton}>
          <Ionicons 
            name={isDark ? 'sunny' : 'moon'} 
            size={24} 
            color={theme.primary} 
          />
        </TouchableOpacity>
      </View>

      {/* Content */}
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Chapter Title */}
        <Text style={[styles.chapterTitle, { color: theme.text }]}>
          {currentChapterData?.title || `Chapter ${currentChapter + 1}`}
        </Text>
        
        {/* Chapter Content */}
        <Text 
          style={[
            styles.contentText, 
            { 
              fontSize, 
              lineHeight: fontSize * 1.75, 
              color: theme.text,
            }
          ]}
        >
          {currentChapterData?.content || 'No content found'}
        </Text>
      </ScrollView>

      {/* Navigation */}
      <View style={[styles.navigation, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
        <TouchableOpacity
          onPress={previousChapter}
          disabled={currentChapter === 0}
          style={[
            styles.navButton,
            currentChapter === 0 && styles.navButtonDisabled,
          ]}
        >
          <Ionicons 
            name="chevron-back" 
            size={24} 
            color={currentChapter === 0 ? theme.border : theme.primary} 
          />
          <Text 
            style={[
              styles.navButtonText, 
              { color: currentChapter === 0 ? theme.border : theme.primary }
            ]}
          >
            Previous
          </Text>
        </TouchableOpacity>

        <View style={[styles.navDivider, { backgroundColor: theme.border }]} />

        <TouchableOpacity
          onPress={nextChapter}
          disabled={currentChapter === chapters.length - 1}
          style={[
            styles.navButton,
            currentChapter === chapters.length - 1 && styles.navButtonDisabled,
          ]}
        >
          <Text 
            style={[
              styles.navButtonText, 
              { color: currentChapter === chapters.length - 1 ? theme.border : theme.primary }
            ]}
          >
            Next
          </Text>
          <Ionicons 
            name="chevron-forward" 
            size={24} 
            color={currentChapter === chapters.length - 1 ? theme.border : theme.primary} 
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    textAlign: 'center',
    marginTop: 16,
    marginBottom: 24,
  },
  retryButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  header: {
    paddingTop: 50,
    paddingBottom: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
  },
  headerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  coverThumbnail: {
    width: 40,
    height: 60,
    borderRadius: 4,
    marginRight: 12,
    backgroundColor: '#e0e0e0',
  },
  headerInfo: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 2,
  },
  headerAuthor: {
    fontSize: 13,
    marginTop: 2,
  },
  headerProgress: {
    fontSize: 12,
    marginTop: 4,
    fontWeight: '600',
  },
  controlsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
  },
  fontControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  controlButton: {
    padding: 4,
  },
  fontSizeLabel: {
    fontSize: 14,
    fontWeight: '600',
    minWidth: 45,
    textAlign: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 24,
    paddingBottom: 60,
  },
  chapterTitle: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 24,
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  contentText: {
    textAlign: 'justify',
    letterSpacing: 0.3,
    fontFamily: 'System',
  },
  navigation: {
    flexDirection: 'row',
    borderTopWidth: 1,
  },
  navButton: {
    flex: 1,
    flexDirection: 'row',
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  navButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  navDivider: {
    width: 1,
  },
});
