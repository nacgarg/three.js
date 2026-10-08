import NodeMaterialObserver from '../../../../../../src/materials/nodes/manager/NodeMaterialObserver.js';
import BindGroup from '../../../../../../src/renderers/common/BindGroup.js';
import { Material } from '../../../../../../src/materials/Material.js';
import { Mesh } from '../../../../../../src/objects/Mesh.js';
import { BufferGeometry } from '../../../../../../src/core/BufferGeometry.js';
import { Scene } from '../../../../../../src/scenes/Scene.js';
import { Texture } from '../../../../../../src/textures/Texture.js';
import { Vector3 } from '../../../../../../src/math/Vector3.js';
import { RenderObjectRefreshType } from '../../../../../../src/constants.js';
import { NodeUpdateType } from '../../../../../../src/nodes/core/constants.js';

const { FULL, SHARED, NONE } = RenderObjectRefreshType;

function createUniformNode( value, updateType = NodeUpdateType.NONE ) {

	return { isUniformNode: true, value, updateType, groupNode: { shared: false } };

}

// a node material with a single object-scope uniform group and one sampled texture

function createSetup( { bundleStatic = true } = {} ) {

	const material = new Material();
	material.colorNode = { isNode: true }; // a node material

	const object = new Mesh();
	const scene = new Scene();

	const uniformNode = createUniformNode( 1 );
	const vectorNode = createUniformNode( new Vector3( 1, 2, 3 ) );
	const textureNode = createUniformNode( new Texture() );

	const objectGroup = {
		isNodeUniformsGroup: true,
		isUniformBuffer: true,
		groupNode: { shared: false },
		uniforms: [ { nodeUniform: { node: uniformNode } }, { nodeUniform: { node: vectorNode } } ]
	};

	const sampledTexture = { isSampledTexture: true, groupNode: { shared: false }, textureNode };

	const nodeBuilderState = { updateNodes: [], updateBeforeNodes: [], updateAfterNodes: [] };
	const bindGroups = [ new BindGroup( 'object', [ objectGroup, sampledTexture ] ) ];

	const bundle = { static: bundleStatic, version: 0 };

	const lightsNode = { getBuiltinLights: () => [] };

	const createRenderObject = () => ( {
		object,
		material,
		geometry: new BufferGeometry(),
		scene,
		bundle,
		lightsNode,
		context: { width: 1, height: 1 },
		getNodeBuilderState: () => nodeBuilderState,
		getBindings: () => bindGroups
	} );

	const observer = new NodeMaterialObserver( { material, context: {}, object } );

	const nodeFrame = { renderId: 0, renderer: { getMRT: () => null } };

	const refresh = ( renderObject ) => observer.needsRefresh( renderObject, nodeFrame );

	return { observer, nodeFrame, refresh, createRenderObject, object, bundle, material, uniformNode, vectorNode, textureNode };

}

export default QUnit.module( 'Materials', () => {

	QUnit.module( 'Nodes', () => {

		QUnit.module( 'NodeMaterialObserver', () => {

			QUnit.test( 'static bundle content with a node material is only refreshed when something changed', ( assert ) => {

				const { nodeFrame, refresh, createRenderObject, uniformNode, vectorNode, object } = createSetup();

				const renderObject = createRenderObject();

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), FULL, 'First refresh is a full refresh.' );

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), SHARED, 'Unchanged: only the shared uniforms, once per render.' );
				assert.strictEqual( refresh( renderObject ), NONE, 'Unchanged: nothing for the rest of the render.' );

				nodeFrame.renderId ++;
				uniformNode.value = 2;
				assert.strictEqual( refresh( renderObject ), FULL, 'A changed object-scope uniform value requires a full refresh.' );

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), SHARED, 'The new value is not reported again.' );

				nodeFrame.renderId ++;
				vectorNode.value.x = 5;
				assert.strictEqual( refresh( renderObject ), FULL, 'Values of vector uniforms are compared.' );

				nodeFrame.renderId ++;
				object.position.x = 1;
				object.updateMatrixWorld();
				assert.strictEqual( refresh( renderObject ), FULL, 'A moved object requires a full refresh.' );

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), SHARED, 'Back to shared refreshes.' );

			} );

			QUnit.test( 'object-scope uniform changes are detected once per render for all render objects', ( assert ) => {

				const { nodeFrame, refresh, createRenderObject, uniformNode } = createSetup();

				const renderObjectA = createRenderObject();
				const renderObjectB = createRenderObject();

				nodeFrame.renderId ++;
				refresh( renderObjectA );
				refresh( renderObjectB );

				nodeFrame.renderId ++;
				uniformNode.value = 3;

				assert.strictEqual( refresh( renderObjectA ), FULL, 'First render object is refreshed.' );
				assert.strictEqual( refresh( renderObjectB ), FULL, 'Second render object is refreshed as well.' );

				nodeFrame.renderId ++;

				assert.strictEqual( refresh( renderObjectA ), SHARED, 'No change for the first render object.' );
				assert.strictEqual( refresh( renderObjectB ), NONE, 'No change for the second render object.' );

			} );

			QUnit.test( 'a new texture version is uploaded without a full refresh', ( assert ) => {

				const { observer, nodeFrame, refresh, createRenderObject, textureNode } = createSetup();

				const renderObject = createRenderObject();

				nodeFrame.renderId ++;
				refresh( renderObject );

				nodeFrame.renderId ++;
				textureNode.value.needsUpdate = true;

				assert.strictEqual( refresh( renderObject ), SHARED, 'Only the shared uniforms are refreshed.' );
				assert.strictEqual( observer.resourcesRenderId, nodeFrame.renderId, 'The texture upload is requested for this render.' );

				nodeFrame.renderId ++;
				textureNode.value = new Texture();

				assert.strictEqual( refresh( renderObject ), FULL, 'A replaced texture requires a full refresh.' );

			} );

			QUnit.test( 'node materials outside of static content are always refreshed', ( assert ) => {

				const { nodeFrame, refresh, createRenderObject } = createSetup( { bundleStatic: false } );

				const renderObject = createRenderObject();

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), FULL );

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), FULL );

			} );

			QUnit.test( 'uniforms updated per frame keep static content on full refreshes', ( assert ) => {

				const { nodeFrame, refresh, createRenderObject, uniformNode } = createSetup();

				uniformNode.updateType = NodeUpdateType.FRAME;

				const renderObject = createRenderObject();

				nodeFrame.renderId ++;
				refresh( renderObject );

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), FULL );

			} );

			QUnit.test( 'an updated bundle refreshes its render objects', ( assert ) => {

				const { nodeFrame, refresh, createRenderObject, bundle } = createSetup();

				const renderObject = createRenderObject();

				nodeFrame.renderId ++;
				refresh( renderObject );

				nodeFrame.renderId ++;
				bundle.version ++;
				assert.strictEqual( refresh( renderObject ), FULL );

				nodeFrame.renderId ++;
				assert.strictEqual( refresh( renderObject ), SHARED );

			} );

		} );

	} );

} );
