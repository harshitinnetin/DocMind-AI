import path from 'path';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { createWorker } from 'tesseract.js';
import prisma from '../config/prisma.js';
import openrouter from '../config/openrouter.js';

const CHUNK_SIZE = 500; // words per chunk
const CHUNK_OVERLAP = 50;

// Split text into overlapping chunks
const chunkText = (text) => {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const chunks = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    const chunkWords = words.slice(start, end);
    chunks.push(chunkWords.join(' '));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
    if (start >= words.length) break;
  }

  return chunks;
};

// Generate embedding for a text
const generateEmbedding = async (text) => {
  try {
    const response = await openrouter.embeddings.create({
      model: 'openai/text-embedding-3-small',
      input: text.slice(0, 8000),
    });
    return response.data[0].embedding;
  } catch (error) {
    console.error('Embedding error:', error.message);
    return null;
  }
};

// Extract text from digital PDF buffer
const extractPDFText = async (buffer) => {
  const data = await pdfParse(buffer);
  return { text: data.text, pageCount: data.numpages, isScanned: false };
};

// Extract text from scanned image/PDF buffer using OCR
const extractOCRText = async (buffer, mimeType = 'image/png') => {
  const worker = await createWorker('eng');
  try {
    // Tesseract accepts a buffer directly
    const { data } = await worker.recognize(buffer);
    await worker.terminate();
    return {
      text: data.text,
      pageCount: 1,
      isScanned: true,
      ocrConfidence: data.confidence,
    };
  } catch (error) {
    await worker.terminate();
    throw error;
  }
};

// Main document processing pipeline
// Now accepts a Buffer instead of a file path — no local disk access needed.
export const processDocument = async (documentId, buffer, fileName) => {
  try {
    console.log(`Processing document: ${documentId}`);

    // Step 1: Extract text from buffer
    let extractionResult;
    const isPDF = fileName.toLowerCase().endsWith('.pdf');

    if (isPDF) {
      try {
        extractionResult = await extractPDFText(buffer);
        // If text is very short, likely scanned
        if (extractionResult.text.trim().length < 100) {
          console.log('PDF appears to be scanned, using OCR...');
          extractionResult = await extractOCRText(buffer, 'application/pdf');
        }
      } catch (pdfError) {
        console.log('PDF parse failed, trying OCR...');
        extractionResult = await extractOCRText(buffer, 'application/pdf');
      }
    } else {
      // Image file — use OCR directly on buffer
      extractionResult = await extractOCRText(buffer);
    }

    const { text, pageCount, isScanned, ocrConfidence } = extractionResult;

    if (!text || text.trim().length < 10) {
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'FAILED' },
      });
      return;
    }

    // Step 2: Chunk the text
    const textChunks = chunkText(text);
    console.log(`Generated ${textChunks.length} chunks`);

    // Step 3: Generate embeddings and save chunks
    const chunkData = [];
    for (let i = 0; i < textChunks.length; i++) {
      const chunk = textChunks[i];
      const embedding = await generateEmbedding(chunk);

      chunkData.push({
        documentId,
        content: chunk,
        chunkIndex: i,
        pageNumber: Math.floor((i / textChunks.length) * pageCount) + 1,
        tokenCount: Math.ceil(chunk.split(/\s+/).length * 1.3),
        embedding: embedding ? JSON.stringify(embedding) : null,
      });
    }

    // Save all chunks
    await prisma.documentChunk.createMany({ data: chunkData });

    const totalTokens = chunkData.reduce((sum, c) => sum + (c.tokenCount || 0), 0);

    // Step 4: Update document as ready
    await prisma.document.update({
      where: { id: documentId },
      data: {
        status: 'READY',
        pageCount: pageCount || 1,
        isScanned: isScanned || false,
        ocrConfidence: ocrConfidence || null,
        tokenCount: totalTokens,
      },
    });

    console.log(`✅ Document ${documentId} processed successfully. ${textChunks.length} chunks.`);
  } catch (error) {
    console.error(`❌ Document processing failed: ${documentId}`, error);
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED' },
    }).catch(() => {});
  }
};
