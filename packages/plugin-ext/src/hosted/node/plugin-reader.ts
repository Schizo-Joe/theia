/********************************************************************************
 * Copyright (C) 2018 Red Hat, Inc. and others.
 *
 * This program and the accompanying materials are made available under the
 * terms of the Eclipse Public License v. 2.0 which is available at
 * http://www.eclipse.org/legal/epl-2.0.
 *
 * This Source Code may also be made available under the following Secondary
 * Licenses when the conditions for such availability set forth in the Eclipse
 * Public License v. 2.0 are satisfied: GNU General Public License, version 2
 * with the GNU Classpath Exception which is available at
 * https://www.gnu.org/software/classpath/license.html.
 *
 * SPDX-License-Identifier: EPL-2.0 OR GPL-2.0 WITH Classpath-exception-2.0
 ********************************************************************************/

import * as path from 'path';
import * as express from 'express';
import * as escape_html from 'escape-html';
import { ILogger } from '@theia/core';
import { inject, injectable, optional, multiInject } from 'inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { PluginMetadata, getPluginId, MetadataProcessor, PluginModelOptions } from '../../common/plugin-protocol';
import { MetadataScanner } from './metadata-scanner';
import { loadManifest } from './plugin-manifest-loader';

@injectable()
export class HostedPluginReader implements BackendApplicationContribution {

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(MetadataScanner)
    private readonly scanner: MetadataScanner;

    @optional()
    @multiInject(MetadataProcessor) private readonly metadataProcessors: MetadataProcessor[];

    /**
     * Map between a plugin id and its local storage
     */
    protected pluginsIdsFiles: Map<string, string> = new Map();

    configure(app: express.Application): void {
        app.get('/hostedPlugin/:pluginId/:path(*)', async (req, res) => {
            const pluginId = req.params.pluginId;
            const filePath = req.params.path;

            const localPath = this.pluginsIdsFiles.get(pluginId);
            if (localPath) {
                res.sendFile(filePath, { root: localPath }, e => {
                    if (!e) {
                        // the file was found and successfully transfered
                        return;
                    }
                    console.error(`Could not transfer '${filePath}' file from '${pluginId}'`, e);
                    if (res.headersSent) {
                        // the request was already closed
                        return;
                    }
                    if ('code' in e && e['code'] === 'ENOENT') {
                        res.status(404).send(`No such file found in '${escape_html(pluginId)}' plugin.`);
                    } else {
                        res.status(500).send(`Failed to transfer a file from '${escape_html(pluginId)}' plugin.`);
                    }
                });
            } else {
                await this.handleMissingResource(req, res);
            }
        });
    }

    protected async handleMissingResource(req: express.Request, res: express.Response): Promise<void> {
        const pluginId = req.params.pluginId;
        res.status(404).send(`The plugin with id '${escape_html(pluginId)}' does not exist.`);
    }

    async getPluginMetadata(pluginPath: string, options: PluginModelOptions): Promise<PluginMetadata | undefined> {
        return this.doGetPluginMetadata(pluginPath, options);
    }

    /**
     * MUST never throw to isolate plugin deployment
     */
    async doGetPluginMetadata(pluginPath: string | undefined, options: PluginModelOptions): Promise<PluginMetadata | undefined> {
        try {
            if (!pluginPath) {
                return undefined;
            }
            pluginPath = path.normalize(pluginPath + '/');
            return await this.loadPluginMetadata(pluginPath, options);
        } catch (e) {
            this.logger.error(`Failed to load plugin metadata from "${pluginPath}"`, e);
            return undefined;
        }
    }

    protected async loadPluginMetadata(pluginPath: string, options: PluginModelOptions): Promise<PluginMetadata | undefined> {
        const manifest = await loadManifest(pluginPath);
        if (!manifest) {
            return undefined;
        }
        manifest.packagePath = pluginPath;
        const pluginMetadata = this.scanner.getPluginMetadata(manifest, options);
        if (pluginMetadata.model.entryPoint.backend) {
            pluginMetadata.model.entryPoint.backend = path.resolve(pluginPath, pluginMetadata.model.entryPoint.backend);
        }
        if (pluginMetadata) {
            // Add post processor
            if (this.metadataProcessors) {
                this.metadataProcessors.forEach(metadataProcessor => {
                    metadataProcessor.process(pluginMetadata);
                });
            }
            this.pluginsIdsFiles.set(getPluginId(pluginMetadata.model), pluginPath);
        }
        return pluginMetadata;
    }

}
