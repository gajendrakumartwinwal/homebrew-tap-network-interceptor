import axios from 'axios';
import {mergeResponse, requestInterceptor} from './requestInterceptor';
import mapping from './mapping';
import fs from "fs";
import * as urils from "./mapping/utils";

// Mock axios module and mapping module
jest.mock('axios');
jest.mock('./logger');
jest.mock('./mapping/utils', () => ({
    getMappingConfig: jest.fn(),
    matchUrlPattern: jest.fn(),
    generateMappingJSON: jest.fn(),
    getFunctionFromFile: jest.fn(),
}));
jest.mock('./mapping', () => ({
    overrides: jest.fn(),
    responseData: jest.fn(),
}));

let mockMergeResponse
describe('requestInterceptor', () => {
    mockMergeResponse = jest.fn()
    jest.mock('./requestInterceptor', () => ({
        mergeResponse: mockMergeResponse,
        requestInterceptor: jest.requireActual('./requestInterceptor').requestInterceptor,
    }));

    const interceptedRequest = {
        isInterceptResolutionHandled: jest.fn().mockReturnValue(false),
        continue: jest.fn(),
        respond: jest.fn(),
    };


    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NETWORK_INTERCEPTOR_LOGS=''
    });

    it('should return if resolution is handled', async () => {
        // Arrange
        interceptedRequest.isInterceptResolutionHandled.mockReturnValue(true);

        // Act
        await requestInterceptor(interceptedRequest);

        // Assert
        expect(interceptedRequest.continue).not.toHaveBeenCalled();
        expect(interceptedRequest.respond).not.toHaveBeenCalled();
    });
    it('should continue with overrides if overrides available', async () => {
        // Arrange
        interceptedRequest.isInterceptResolutionHandled.mockReturnValue(false);
        const mockOverrides = {method: {}, url: 'url', headers: {}, postData: {}}
        mapping.overrides.mockResolvedValue(mockOverrides);
        mockMergeResponse.mockReturnValue([mockOverrides, undefined])

        // Act
        await requestInterceptor(interceptedRequest);

        // Assert
        const stringifiedOverrides = mockOverrides ? {...mockOverrides, postData: JSON.stringify(mockOverrides.postData)} : mockOverrides
        expect(interceptedRequest.continue).toHaveBeenCalledTimes(1);
        expect(interceptedRequest.continue).toHaveBeenCalledWith(stringifiedOverrides);
        expect(interceptedRequest.respond).not.toHaveBeenCalled();
    });
    it('should respond with responseData if overrides is not available and responseData is available', async () => {
        // Arrange
        interceptedRequest.isInterceptResolutionHandled.mockReturnValue(false);
        const mockResponseData = {
            key: 'value'
        }
        mapping.overrides.mockResolvedValue(undefined);
        mapping.responseData.mockResolvedValue(mockResponseData);
        mockMergeResponse.mockReturnValue([undefined, mockResponseData])


        // Act
        await requestInterceptor(interceptedRequest);

        // Assert
        expect(interceptedRequest.respond).toHaveBeenCalledTimes(1);
        expect(interceptedRequest.respond).toHaveBeenCalledWith(mockResponseData);
        expect(interceptedRequest.continue).not.toHaveBeenCalled();
    });
    it('should continue without any data', async () => {
        // Arrange
        interceptedRequest.isInterceptResolutionHandled.mockReturnValue(false);
        mapping.overrides.mockResolvedValue(undefined);
        mapping.responseData.mockResolvedValue(undefined);
        mockMergeResponse.mockReturnValue([undefined, undefined])


        // Act
        await requestInterceptor(interceptedRequest);

        // Assert
        expect(interceptedRequest.continue).toHaveBeenCalledTimes(1);
        expect(interceptedRequest.continue).toHaveBeenCalledWith();
        expect(interceptedRequest.respond).not.toHaveBeenCalled();
    });
});
describe('mergeResponse', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        process.env.NETWORK_INTERCEPTOR_LOGS=''
    });

    const mockResponseData = {
        status: 200,
        headers: {
            mockHeaderKey: 'mockHeaderValue'
        },
        contentType: 'application/json',
        body: {
            mockBodyKey: 'mockBodyValue'
        }
    };
    const mockMethod = 'mockMethod'
    const mockURL = 'mockURL'
    const mockHeader = 'mockHeader'
    const mockPostData = {
        mockKey: 'mockValue'
    };
    const mockOverrides = {method: mockMethod, url: mockURL, headers: mockHeader, postData: mockPostData}
    it.each([
        [undefined, {status: 'status', headers: {}, contentType: 'contentType', body: {}}],
        [{method: {}, url: 'url', headers: {}, postData: {}}, undefined],
        [undefined, undefined]
    ])('should return array of overrides and responseData if any of them is undefined', async (mockOverrides, mockResponseData) => {
        // Act
        const response = await mergeResponse(mockOverrides, mockResponseData);

        // Assert
        const stringifiedOverrides = mockOverrides ? {...mockOverrides, postData: JSON.stringify(mockOverrides.postData)} : mockOverrides
        const stringifiedResponseData = mockResponseData ? {...mockResponseData, body: JSON.stringify(mockResponseData.body)} : mockResponseData
        expect(response).toEqual([stringifiedOverrides, stringifiedResponseData])
    });

    describe('overrides and responseData if both available & axios request successful', () => {


        it("should call axios for overrides", async () => {
            // Arrange
            axios.mockReturnValue({
                headers: {}
            })
            await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(axios).toHaveBeenCalledWith({
                method: mockOverrides.method,
                url: mockOverrides.url,
                headers: mockOverrides.headers,
                data: mockOverrides.postData
            })
        })

        it.each([
            [{key1: 'value1'}, undefined, {key1: 'value1'}],
            [{}, {key1: 'value1'}, {key1: 'value1'}],
            [{key1: 'value1'}, {}, {key1: 'value1'}],
            [{key1: 'value1'}, {key2: 'value2'}, {key1: 'value1', key2: 'value2'}],
            [{key1: 'value1'}, {key2: 'value2', key1: 'keyChanged'}, {key1: 'keyChanged', key2: 'value2'}]
        ])("header should be merged with axios response header", async (mockAxiosHeader, mockResponseHeader, expectedHeaders) => {
            // Arrange
            axios.mockResolvedValue({
                headers: mockAxiosHeader,
                data: {},
            });
            mockResponseData.headers = mockResponseHeader;

            // Act
            const [_, {headers}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(headers).toEqual(expectedHeaders)
        });

        it.each([
            [undefined, undefined, {}],
            [undefined, {key1: 'value1'}, {key1: 'value1'}],
            [{key1: 'value1'}, undefined, {key1: 'value1'}],
            [{}, {key1: 'value1'}, {key1: 'value1'}],
            [{key1: 'value1'}, {}, {key1: 'value1'}],
            [{key1: 'value1'}, {key2: 'value2'}, {key1: 'value1', key2: 'value2'}],
            [{key1: 'value1'}, {key2: 'value2', key1: 'keyChanged'}, {key1: 'keyChanged', key2: 'value2'}],
            [[{key1: 'value1'}], [{key2: 'value2', key1: 'keyChanged'}], [{key1: 'keyChanged', key2: 'value2'}]],
            [[{key1: 'value1'}, {key2: 'value2'}], [{key2: 'value2', key1: 'keyChanged'}], [{key1: 'keyChanged', key2: 'value2'}, {key2: 'value2'}]],
            [[{key1: 'value1'}], [{key2: 'value2', key1: 'keyChanged'}, {key2: 'value2'}], [{key1: 'keyChanged', key2: 'value2'}, {key2: 'value2'}]],
            [[{key1: 'value1'}, {key2: 'value2'}], [{key2: 'value2', key1: 'keyChanged'}, {key2: 'keyChanged'}], [{key1: 'keyChanged', key2: 'value2'}, {key2: 'keyChanged'}]]
        ])("json body should be merged with axios body: %s & %s", async (mockAxiosBody, mockResponseBody, expectedBody) => {
            // Arrange
            axios.mockResolvedValue({
                headers: {},
                data: mockAxiosBody,
            });
            mockResponseData.body = mockResponseBody;

            // Act
            const [_, {body}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(body).toEqual(JSON.stringify(expectedBody))
        });

        it.each([
            ['<HTML Content>', undefined, '<HTML Content>'],
            ['<HTML Content>', {key1: 'value1'}, '<HTML Content>'],
            ['<HTML Content>', '<HTML Content1>', '<HTML Content>'],
        ])("non json body should be merged with axios body: %s & %s", async (mockAxiosBody, mockResponseBody, expectedBody) => {
            // Arrange
            axios.mockResolvedValue({
                headers: {},
                data: mockAxiosBody,
            });
            mockResponseData.body = mockResponseBody;

            // Act
            const [_, {body}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(body).toEqual(expectedBody)
        });

        it.each([
            [200, 200, 200],
            [200, undefined, 200],
            [200, 500, 500],
            [500, 200, 200],
        ])("status should be merged with axios status", async (mockAxiosStatus, mockResponseStatus, expectedStatus) => {
            // Arrange
            axios.mockResolvedValue({
                headers: {},
                data: {},
                status: mockAxiosStatus,
            });
            mockResponseData.status = mockResponseStatus;

            // Act
            const [_, {status}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(expectedStatus).toEqual(status)
        });
        it.each([
            ['application/json', 'application/json', 'application/json'],
            ['application/json', undefined, 'application/json'],
            ['application/json', 'file', 'file'],
            ['file', 'application/json', 'application/json'],
        ])("contentType: %s should be merged with axios contentType %s", async (mockAxiosContentType, mockResponseContentType, expectedContentType) => {
            // Arrange
            axios.mockResolvedValue({
                headers: {
                    ['content-type']: mockAxiosContentType
                },
                data: {},
            });
            mockResponseData.contentType = mockResponseContentType;

            // Act
            const [_, {contentType}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(contentType).toEqual(expectedContentType)
        });
    })
    describe('overrides and responseData if both available & axios request failed', () => {

        it.each([
            [{key1: 'value1'}, undefined, {key1: 'value1'}],
            [{}, {key1: 'value1'}, {key1: 'value1'}],
            [{key1: 'value1'}, {}, {key1: 'value1'}],
            [{key1: 'value1'}, {key2: 'value2'}, {key1: 'value1', key2: 'value2'}],
            [{key1: 'value1'}, {key2: 'value2', key1: 'keyChanged'}, {key1: 'keyChanged', key2: 'value2'}]
        ])("header should be merged with axios error headers: %s and response headers: %s", async (mockAxiosHeader, mockResponseHeader, expectedHeaders) => {
            // Arrange
            const error = new Error('Async error');
            error.response = {
                headers: mockAxiosHeader,
                data: {}
            }
            axios.mockRejectedValue(error);
            mockResponseData.headers = mockResponseHeader;

            // Act
            const [_, {headers}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(headers).toEqual(expectedHeaders)
        });

        it.each([
            [undefined, undefined, {}],
            [undefined, {key1: 'value1'}, {key1: 'value1'}],
            [{key1: 'value1'}, undefined, {key1: 'value1'}],
            [{}, {key1: 'value1'}, {key1: 'value1'}],
            [{key1: 'value1'}, {}, {key1: 'value1'}],
            [{key1: 'value1'}, {key2: 'value2'}, {key1: 'value1', key2: 'value2'}],
            [{key1: 'value1'}, {key2: 'value2', key1: 'keyChanged'}, {key1: 'keyChanged', key2: 'value2'}],
            [[{key1: 'value1'}], [{key2: 'value2', key1: 'keyChanged'}], [{key1: 'keyChanged', key2: 'value2'}]],
            [[{key1: 'value1'}, {key2: 'value2'}], [{key2: 'value2', key1: 'keyChanged'}], [{key1: 'keyChanged', key2: 'value2'}, {key2: 'value2'}]],
            [[{key1: 'value1'}], [{key2: 'value2', key1: 'keyChanged'}, {key2: 'value2'}], [{key1: 'keyChanged', key2: 'value2'}, {key2: 'value2'}]],
            [[{key1: 'value1'}, {key2: 'value2'}], [{key2: 'value2', key1: 'keyChanged'}, {key2: 'keyChanged'}], [{key1: 'keyChanged', key2: 'value2'}, {key2: 'keyChanged'}]]
        ])("json body should be merged with axios error body: %s & %s", async (mockAxiosBody, mockResponseBody, expectedBody) => {
            // Arrange
            const error = new Error('Async error');
            error.response = {
                headers: {},
                data: mockAxiosBody
            }
            axios.mockRejectedValue(error);
            mockResponseData.body = mockResponseBody;

            // Act
            const [_, {body}] = await mergeResponse(mockOverrides, mockResponseData);
            // Assert
            expect(body).toEqual(JSON.stringify(expectedBody))
        });
        it.each([
            ['<HTML Content>', undefined, '<HTML Content>'],
            ['<HTML Content>', {key1: 'value1'}, '<HTML Content>'],
            ['<HTML Content>', '<HTML Content1>', '<HTML Content>'],
        ])("json body should be merged with axios error body: %s & %s", async (mockAxiosBody, mockResponseBody, expectedBody) => {
            // Arrange
            const error = new Error('Async error');
            error.response = {
                headers: {},
                data: mockAxiosBody
            }
            axios.mockRejectedValue(error);
            mockResponseData.body = mockResponseBody;

            // Act
            const [_, {body}] = await mergeResponse(mockOverrides, mockResponseData);
            // Assert
            expect(body).toEqual(expectedBody)
        });

        it.each([
            [200, 200, 200],
            [200, undefined, 200],
            [200, 500, 500],
            [500, 200, 200],
        ])("status should be merged with axios status", async (mockAxiosStatus, mockResponseStatus, expectedStatus) => {
            // Arrange
            const error = new Error('Async error');
            error.response = {
                status: mockAxiosStatus,
                headers: {},
                data: {}
            }
            axios.mockRejectedValue(error);
            mockResponseData.status = mockResponseStatus;

            // Act
            const [_, {status}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(expectedStatus).toEqual(status)
        });
        it.each([
            ['application/json', 'application/json', 'application/json'],
            ['application/json', undefined, 'application/json'],
            ['application/json', 'file', 'file'],
            ['file', 'application/json', 'application/json'],
        ])("contentType: %s should be merged with axios contentType %s", async (mockAxiosContentType, mockResponseContentType, expectedContentType) => {
            // Arrange
            const error = new Error('Async error');
            error.response = {
                headers: {
                    ['content-type']: mockAxiosContentType
                },
                data: {}
            }
            axios.mockRejectedValue(error);
            mockResponseData.contentType = mockResponseContentType;

            // Act
            const [_, {contentType}] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(contentType).toEqual(expectedContentType)
        });
    })
    describe('mapFunctionPath', () => {
        it('mapFunctionPath should return modified data if both overrides and responseData available', async () => {
            // Arrange
            const mockMapFuntion = () => ({
                contentType: 'application/json',
                status: '201',
                headers: {
                    'mapFunctionHeaderKey': 'mapFunctionHeaderValue'
                },
                body: {
                    'mapFunctionPostDataKey': 'mapFunctionPostDataValue'
                },
            })
            urils.getFunctionFromFile.mockReturnValue(mockMapFuntion)

            const error = new Error('Async error');
            error.response = {
                headers: {
                    ['content-type']: 'application/json'
                },
                data: {}
            }
            axios.mockRejectedValue(error);
            mockResponseData.contentType = 'file';
            mockResponseData.mapFunctionPath = 'mapFunctionPath';

            // Act
            const [_, response] = await mergeResponse(mockOverrides, mockResponseData);

            // Assert
            expect(response).toEqual(mockMapFuntion())
        })
        it('mapFunctionPath should return modified data if only responseData available', async () => {
            // Arrange
            const mockMapFuntion = () => ({
                contentType: 'application/json',
                status: '201',
                headers: {
                    'mapFunctionHeaderKey': 'mapFunctionHeaderValue'
                },
                body: {
                    'mapFunctionPostDataKey': 'mapFunctionPostDataValue'
                },
            })
            urils.getFunctionFromFile.mockReturnValue(mockMapFuntion)

            mockResponseData.contentType = 'file';
            mockResponseData.mapFunctionPath = 'mapFunctionPath';

            // Act
            const [_, response] = await mergeResponse(undefined, mockResponseData);

            // Assert
            const expected = {
                ...mockMapFuntion(),
                body: JSON.stringify(mockMapFuntion().body)
            }
            expect(response).toEqual(expected)
        })
    })
});