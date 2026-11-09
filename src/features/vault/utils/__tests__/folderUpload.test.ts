import { describe, expect, it } from 'vitest';
import { MAX_VAULT_FILE_SIZE_BYTES } from '../../../../core/crypto/vaultCrypto';
import {
  isIgnoredSystemFile,
  resolveLogicalDocumentName,
  splitFolderAndFileName,
  validateAndPrepareFiles,
} from '../folderUpload';

describe('folderUpload utils', () => {
  describe('isIgnoredSystemFile', () => {
    it('detecta archivos de sistema y metadatos ocultos del SO', () => {
      expect(isIgnoredSystemFile('.DS_Store')).toBe(true);
      expect(isIgnoredSystemFile('.ds_store')).toBe(true);
      expect(isIgnoredSystemFile('Thumbs.db')).toBe(true);
      expect(isIgnoredSystemFile('desktop.ini')).toBe(true);
      expect(isIgnoredSystemFile('.spotlight-v100')).toBe(true);
      expect(isIgnoredSystemFile('.trashes')).toBe(true);
      expect(isIgnoredSystemFile('._archivo.pdf')).toBe(true);
      expect(isIgnoredSystemFile('Carpeta/.DS_Store')).toBe(true);
      expect(isIgnoredSystemFile('Carpeta\\Thumbs.db')).toBe(true);
    });

    it('permite archivos legítimos de usuario', () => {
      expect(isIgnoredSystemFile('contrato.pdf')).toBe(false);
      expect(isIgnoredSystemFile('Clientes/2026/balance.xlsx')).toBe(false);
      expect(isIgnoredSystemFile('.env')).toBe(false);
    });
  });

  describe('resolveLogicalDocumentName y splitFolderAndFileName', () => {
    it('resuelve nombres de archivos sueltos y rutas relativas con barras limpias', () => {
      const file = new File(['hola'], 'contrato.pdf', { type: 'application/pdf' });
      expect(resolveLogicalDocumentName(file)).toBe('contrato.pdf');

      expect(resolveLogicalDocumentName(file, 'Clientes/2026/contrato.pdf')).toBe(
        'Clientes/2026/contrato.pdf',
      );
      expect(resolveLogicalDocumentName(file, 'Clientes\\2026\\contrato.pdf')).toBe(
        'Clientes/2026/contrato.pdf',
      );
      expect(resolveLogicalDocumentName(file, '///Clientes//2026///contrato.pdf///')).toBe(
        'Clientes/2026/contrato.pdf',
      );

      const fileWithRelative = new File(['hola'], 'documento.docx');
      Object.defineProperty(fileWithRelative, 'webkitRelativePath', {
        value: 'Empresa/Legal/documento.docx',
      });
      expect(resolveLogicalDocumentName(fileWithRelative)).toBe('Empresa/Legal/documento.docx');
    });

    it('separa folderPath y baseName adecuadamente para insignias visuales', () => {
      expect(splitFolderAndFileName('contrato.pdf')).toEqual({
        folderPath: null,
        baseName: 'contrato.pdf',
      });

      expect(splitFolderAndFileName('Clientes/2026/contrato.pdf')).toEqual({
        folderPath: 'Clientes/2026',
        baseName: 'contrato.pdf',
      });

      expect(splitFolderAndFileName('/Proyectos/Alpha/spec.md')).toEqual({
        folderPath: 'Proyectos/Alpha',
        baseName: 'spec.md',
      });
    });
  });

  describe('validateAndPrepareFiles', () => {
    it('rechaza archivos vacíos de 0 bytes', () => {
      const emptyFile = new File([], 'vacio.txt');
      const result = validateAndPrepareFiles([{ file: emptyFile }]);
      expect(result.validFiles).toHaveLength(0);
      expect(result.error).toContain('está vacío (0 bytes)');
    });

    it('rechaza archivos que superen los 50 MB de Supabase Storage', () => {
      const hugeFile = new File(['dummy'], 'backup.iso');
      Object.defineProperty(hugeFile, 'size', {
        value: MAX_VAULT_FILE_SIZE_BYTES + 1,
      });

      const result = validateAndPrepareFiles([{ file: hugeFile }]);
      expect(result.validFiles).toHaveLength(0);
      expect(result.error).toContain('supera el límite máximo de 50.00 MB');
    });

    it('descarta archivos ocultos del SO y acepta lotes válidos con nombres lógicos', () => {
      const validFile1 = new File(['data1'], 'presupuesto.xlsx');
      const validFile2 = new File(['data2'], 'memoria.pdf');
      const systemFile = new File(['trash'], '.DS_Store');

      const candidates = [
        { file: systemFile, relativePath: 'Finanzas/.DS_Store' },
        { file: validFile1, relativePath: 'Finanzas/presupuesto.xlsx' },
        { file: validFile2, relativePath: 'Finanzas/memoria.pdf' },
      ];

      const result = validateAndPrepareFiles(candidates);
      expect(result.error).toBeNull();
      expect(result.validFiles).toHaveLength(2);
      expect(result.validFiles[0]?.logicalName).toBe('Finanzas/presupuesto.xlsx');
      expect(result.validFiles[1]?.logicalName).toBe('Finanzas/memoria.pdf');
    });
  });
});
