/********************************************************************************
 * Copyright (C) 2019 RedHat and others.
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

import { injectable, inject } from 'inversify';
import { ILogger } from '@theia/core';
import { PluginDeployerHandler, PluginDeployerEntry, PluginMetadata, PluginModelOptions } from '../../common/plugin-protocol';
import { HostedPluginReader } from './plugin-reader';
import { Deferred } from '@theia/core/lib/common/promise-util';

@injectable()
export class HostedPluginDeployerHandler implements PluginDeployerHandler {

    @inject(ILogger)
    protected readonly logger: ILogger;

    @inject(HostedPluginReader)
    private readonly reader: HostedPluginReader;

    /**
     * Managed plugin metadata backend entries.
     */
    private readonly currentBackendPluginsMetadata = new Map<string, PluginMetadata>();

    /**
     * Managed plugin metadata frontend entries.
     */
    private readonly currentFrontendPluginsMetadata = new Map<string, PluginMetadata>();

    private backendPluginsMetadataDeferred = new Deferred<void>();

    private frontendPluginsMetadataDeferred = new Deferred<void>();

    async getDeployedFrontendMetadata(): Promise<PluginMetadata[]> {
        // await first deploy
        await this.frontendPluginsMetadataDeferred.promise;
        // fetch the last deployed state
        return [...this.currentFrontendPluginsMetadata.values()];
    }

    async getDeployedBackendMetadata(): Promise<PluginMetadata[]> {
        // await first deploy
        await this.backendPluginsMetadataDeferred.promise;
        // fetch the last deployed state
        return [...this.currentBackendPluginsMetadata.values()];
    }

    getDeployedPluginMetadata(pluginId: string): PluginMetadata | undefined {
        const metadata = this.currentBackendPluginsMetadata.get(pluginId);
        if (metadata) {
            return metadata;
        }
        return this.currentFrontendPluginsMetadata.get(pluginId);
    }

    getPluginMetadata(plugin: PluginDeployerEntry, options: PluginModelOptions): Promise<PluginMetadata | undefined> {
        return this.reader.getPluginMetadata(plugin.path(), options);
    }

    async deployFrontendPlugins(frontendPlugins: PluginDeployerEntry[]): Promise<void> {
        for (const plugin of frontendPlugins) {
            const metadata = await this.getPluginMetadata(plugin, { contributions: true });
            if (metadata) {
                if (this.currentFrontendPluginsMetadata.has(metadata.model.id)) {
                    continue;
                }

                this.currentFrontendPluginsMetadata.set(metadata.model.id, metadata);
                this.logger.info(`Deploying frontend plugin "${metadata.model.name}@${metadata.model.version}" from "${metadata.model.entryPoint.frontend || plugin.path()}"`);
            }
        }

        // resolve on first deploy
        this.frontendPluginsMetadataDeferred.resolve(undefined);
    }

    async deployBackendPlugins(backendPlugins: PluginDeployerEntry[]): Promise<void> {
        for (const plugin of backendPlugins) {
            const metadata = await this.reader.getPluginMetadata(plugin.path(), { contributions: true });
            if (metadata) {
                if (this.currentBackendPluginsMetadata.has(metadata.model.id)) {
                    continue;
                }

                this.currentBackendPluginsMetadata.set(metadata.model.id, metadata);
                this.logger.info(`Deploying backend plugin "${metadata.model.name}@${metadata.model.version}" from "${metadata.model.entryPoint.backend || plugin.path()}"`);
            }
        }

        // resolve on first deploy
        this.backendPluginsMetadataDeferred.resolve(undefined);
    }

}
