// Copyright (C) 2025 The Qt Company Ltd.
// SPDX-License-Identifier: LicenseRef-Qt-Commercial OR LGPL-3.0-only

import { XMLParser } from 'fast-xml-parser';
import * as fs from 'fs';

// Define the structure for the QRC XML
interface QRCFile {
  '@_alias': string;
  '#text': string; // The actual file path as text
}

interface QRCResource {
  '@_prefix': string;
  file: QRCFile | QRCFile[]; // A file or an array of files
}

interface QRCParsed {
  RCC: {
    qresource: QRCResource | QRCResource[] | undefined; // One or more qresource elements
  };
}

export class QRCParser {
  private readonly parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      parseAttributeValue: true
    });
  }

  async parseQRCFile(filePath: string): Promise<Map<string, string>> {
    // const xmlContent = fs.readFileSync(filePath, 'utf8');
    // return this.parseQRC(xmlContent);
    return new Promise((resolve, reject) => {
      fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
          reject(err);
        } else {
          resolve(this.parseQRC(data));
        }
      });
    });
  }

  parseQRC(xmlContent: string): Map<string, string> {
    // Parse the XML content into the defined structure
    const jsonObj = this.parser.parse(xmlContent) as QRCParsed; // Type assertion to QRCParsed

    // Extract the resources (qresource)
    const resources = jsonObj.RCC.qresource;

    if (!resources) {
      throw new Error('No qresource found in the QRC file.');
    }

    // Ensure resources is always an array
    const resourcesArray = Array.isArray(resources) ? resources : [resources];

    // Initialize a Map to store file paths and corresponding aliases
    const resourceMap = new Map<string, string>();

    // Loop through each <qresource> and add its files to the map
    resourcesArray.forEach((resource) => {
      const prefix = resource['@_prefix'] || '';
      const files = Array.isArray(resource.file)
        ? resource.file
        : [resource.file];

      files.forEach((file) => {
        const alias = prefix + file['@_alias']; // Use the alias as the key
        const filePath = file['#text']; // Use the file path as the value
        resourceMap.set(alias, filePath); // Store alias as key, file path as value
      });
    });

    // Filter the Map to include only .qml and .js files
    const filteredMap = new Map<string, string>();
    resourceMap.forEach((filePath, alias) => {
      if (filePath.endsWith('.qml') || filePath.endsWith('.js')) {
        filteredMap.set(alias, filePath); // Only keep .qml and .js files
      }
    });

    return filteredMap;
  }
}
